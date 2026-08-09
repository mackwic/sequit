import * as Y from 'yjs';

import {
	type CollaborationTransport,
	TransportStatus,
} from '../collaboration/collaboration-transport';
import {
	type AcceptedMessage,
	CollabMessageKind,
	encodeCollabMessage,
	ProposalIntent,
	type RejectedMessage,
	type SyncResponseMessage,
} from '../collaboration/protocol';
import { replaceNodeMarkdown as applyMarkdown } from '../collaboration/yjs-document-repository';
import {
	CollaborationStatus,
	type CollaborativeDocumentSession,
	type ProposalDecision,
	ProposalDecisionKind,
} from './collaborative-document-session-types';
import {
	cloneCollaborativeYDoc,
	createCollaborativeYDoc,
	readCollaborativeYDoc,
	stateVectorsEqual,
} from './collaborative-session-documents';
import { dispatchSessionFrame } from './collaborative-session-inbound';
import {
	acceptedDecision,
	CommitApplication,
	droppedDecision,
	encodeInitializationProposal,
	encodeSyncRequest,
	initializationWasLost,
	planCommitApplication,
	type SessionPhase,
	SessionPhaseKind,
} from './collaborative-session-model';
import type { DocumentSessionSubscriber } from './document-session';
import { DocumentSessionError } from './document-session';
import type { LogicDocument } from './logic-document';
import {
	coalesce,
	type PendingOperation,
	PendingOperationKind,
	retainReplayable,
} from './pending-operations';

export class CollaborativeSession implements CollaborativeDocumentSession {
	readonly #subscribers = new Set<DocumentSessionSubscriber>();
	readonly #decisionListeners = new Set<(decision: ProposalDecision) => void>();
	readonly #unsubscribeFrames: () => void;
	readonly #unsubscribeStatus: () => void;
	#accepted: Y.Doc;
	#overlay: Y.Doc;
	#pending: readonly PendingOperation[] = [];
	#phase: SessionPhase = { kind: SessionPhaseKind.Disconnected };
	#lastCommit = 0;
	#destroyed = false;

	constructor(
		initialDocument: LogicDocument,
		private readonly transport: CollaborationTransport,
	) {
		this.#accepted = createCollaborativeYDoc(initialDocument);
		this.#overlay = cloneCollaborativeYDoc(this.#accepted);
		this.#unsubscribeFrames = transport.subscribeToFrames(this.#receiveFrame);
		this.#unsubscribeStatus = transport.subscribeToStatus(this.#receiveStatus);
		if (transport.status() === TransportStatus.Connected) this.#startFirstSync();
		if (transport.status() === TransportStatus.Connecting)
			this.#phase = { kind: SessionPhaseKind.FirstSync };
	}

	read(): LogicDocument {
		this.#assertActive();
		return readCollaborativeYDoc(this.#overlay);
	}

	subscribe(listener: DocumentSessionSubscriber): () => void {
		this.#assertActive();
		this.#subscribers.add(listener);
		return () => this.#subscribers.delete(listener);
	}

	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void {
		this.#assertActive();
		this.#decisionListeners.add(listener);
		return () => this.#decisionListeners.delete(listener);
	}

	connectionStatus(): CollaborationStatus {
		if (this.#phase.kind === SessionPhaseKind.Disconnected) return CollaborationStatus.Disconnected;
		if (this.#phase.kind === SessionPhaseKind.Ready) return CollaborationStatus.Ready;
		if (this.transport.status() === TransportStatus.Connecting)
			return CollaborationStatus.Connecting;
		return CollaborationStatus.Synchronizing;
	}

	replaceNodeMarkdown(nodeId: string, markdown: string): boolean {
		if (this.#destroyed) return false;
		const validation = cloneCollaborativeYDoc(this.#overlay);
		const valid = applyMarkdown(validation, nodeId, markdown);
		validation.destroy();
		if (!valid) return false;
		this.#pending = coalesce(this.#pending, {
			kind: PendingOperationKind.ReplaceNodeMarkdown,
			nodeId,
			markdown,
		});
		this.#rebuildOverlay();
		this.#tryPropose();
		return true;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#unsubscribeFrames();
		this.#unsubscribeStatus();
		this.transport.close();
		this.#accepted.destroy();
		this.#overlay.destroy();
		this.#subscribers.clear();
		this.#decisionListeners.clear();
		this.#pending = [];
	}

	readonly #receiveStatus = (status: TransportStatus): void => {
		/* istanbul ignore next -- destroy removes the transport status listener */
		if (this.#destroyed) return;
		if (status === TransportStatus.Connected) {
			if (this.#lastCommit === 0) this.#startFirstSync();
			else this.#startIncrementalResync();
			return;
		}
		if (status === TransportStatus.Disconnected) this.#disconnect();
	};

	readonly #receiveFrame = (frame: Uint8Array): void => {
		/* istanbul ignore next -- destroy removes the transport frame listener */
		if (this.#destroyed) return;
		dispatchSessionFrame(frame, {
			malformed: () => {
				this.#startFullResync();
			},
			syncResponse: (message) => {
				this.#handleSyncResponse(message);
			},
			accepted: (message) => {
				this.#handleAccepted(message);
			},
			rejected: (message) => {
				this.#handleRejected(message);
			},
			protocolError: () => {
				this.#startFullResync();
			},
		});
	};

	#startFirstSync(): void {
		this.#phase = { kind: SessionPhaseKind.FirstSync };
		this.transport.send(encodeSyncRequest(this.#accepted, this.#lastCommit, true));
	}

	#startIncrementalResync(): void {
		this.#restoreInFlight();
		this.#phase = { kind: SessionPhaseKind.IncrementalResync };
		this.transport.send(encodeSyncRequest(this.#accepted, this.#lastCommit, false));
	}

	#startFullResync(): void {
		if (this.transport.status() !== TransportStatus.Connected) {
			this.#disconnect();
			return;
		}
		this.#restoreInFlight();
		this.#phase = { kind: SessionPhaseKind.FullResync };
		this.transport.send(encodeSyncRequest(this.#accepted, this.#lastCommit, true));
	}

	#disconnect(): void {
		this.#restoreInFlight();
		this.#phase = { kind: SessionPhaseKind.Disconnected };
	}

	#restoreInFlight(): void {
		if (this.#phase.kind !== SessionPhaseKind.Ready) return;
		if (this.#phase.inFlight === undefined) return;
		this.#pending = [this.#phase.inFlight.operation, ...this.#pending];
	}

	#handleSyncResponse(message: SyncResponseMessage): void {
		if (this.#phase.kind === SessionPhaseKind.FirstSync && message.commit === 0) {
			this.#initializeRoom();
			return;
		}
		if (this.#phase.kind === SessionPhaseKind.IncrementalResync) {
			Y.applyUpdate(this.#accepted, message.update);
			if (!stateVectorsEqual(Y.encodeStateVector(this.#accepted), message.stateVector)) {
				this.#startFullResync();
				return;
			}
			this.#lastCommit = message.commit;
			this.#becomeReady();
			return;
		}
		if (
			this.#phase.kind !== SessionPhaseKind.FirstSync &&
			this.#phase.kind !== SessionPhaseKind.FullResync
		)
			return;
		const fresh = new Y.Doc();
		try {
			Y.applyUpdate(fresh, message.update);
			if (!stateVectorsEqual(Y.encodeStateVector(fresh), message.stateVector)) return;
		} catch {
			fresh.destroy();
			return;
		}
		this.#accepted.destroy();
		this.#accepted = fresh;
		this.#lastCommit = message.commit;
		this.#becomeReady();
	}

	#initializeRoom(): void {
		const proposalId = crypto.randomUUID();
		this.#phase = { kind: SessionPhaseKind.Initializing, proposalId };
		this.transport.send(encodeInitializationProposal(this.#accepted, proposalId));
	}

	#handleAccepted(message: AcceptedMessage): void {
		if (this.#phase.kind === SessionPhaseKind.Initializing) {
			if (message.proposalId !== this.#phase.proposalId) {
				this.#startFullResync();
				return;
			}
			this.#emitDecision(acceptedDecision(message.proposalId, message.commit));
		}
		let settled = false;
		if (this.#phase.kind === SessionPhaseKind.Ready) settled = this.#settleInFlight(message);
		const application = planCommitApplication(this.#lastCommit, message.commit);
		if (application === CommitApplication.IncrementalResync) {
			this.#startIncrementalResync();
			return;
		}
		if (application === CommitApplication.Apply) {
			Y.applyUpdate(this.#accepted, message.update);
			this.#lastCommit = message.commit;
			if (!stateVectorsEqual(Y.encodeStateVector(this.#accepted), message.stateVector)) {
				this.#startFullResync();
				return;
			}
		}
		if (this.#phase.kind === SessionPhaseKind.Initializing)
			this.#phase = { kind: SessionPhaseKind.Ready };
		if (settled || application === CommitApplication.Apply) this.#rebuildOverlay();
		this.#tryPropose();
	}

	#settleInFlight(message: AcceptedMessage): boolean {
		/* istanbul ignore next -- callers invoke this only from the Ready branch */
		if (this.#phase.kind !== SessionPhaseKind.Ready) return false;
		if (this.#phase.inFlight?.proposalId !== message.proposalId) return false;
		this.#phase = { kind: SessionPhaseKind.Ready };
		this.#emitDecision(acceptedDecision(message.proposalId, message.commit));
		return true;
	}

	#handleRejected(message: RejectedMessage): void {
		const lostInitialization =
			this.#phase.kind === SessionPhaseKind.Initializing &&
			initializationWasLost(message.diagnostics);
		if (lostInitialization) {
			this.#startFullResync();
			return;
		}
		if (this.#phase.kind !== SessionPhaseKind.Ready) return;
		if (this.#phase.inFlight?.proposalId !== message.proposalId) return;
		this.#phase = { kind: SessionPhaseKind.Ready };
		this.#emitDecision({
			type: ProposalDecisionKind.Rejected,
			proposalId: message.proposalId,
			diagnostics: message.diagnostics,
		});
		this.#rebuildOverlay();
		this.#tryPropose();
	}

	#becomeReady(): void {
		this.#phase = { kind: SessionPhaseKind.Ready };
		this.#rebuildOverlay();
		this.#tryPropose();
	}

	#tryPropose(): void {
		if (this.#phase.kind !== SessionPhaseKind.Ready) return;
		if (this.#phase.inFlight !== undefined) return;
		/* istanbul ignore next -- transport disconnection synchronously leaves Ready */
		if (this.transport.status() !== TransportStatus.Connected) return;
		const operation = this.#pending[0];
		if (operation === undefined) return;
		const proposalId = operation.proposalId ?? crypto.randomUUID();
		const assigned = { ...operation, proposalId };
		const candidate = cloneCollaborativeYDoc(this.#accepted);
		applyMarkdown(candidate, assigned.nodeId, assigned.markdown);
		const update = Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(this.#accepted));
		candidate.destroy();
		this.transport.send(
			encodeCollabMessage({
				type: CollabMessageKind.Proposal,
				proposalId,
				intent: ProposalIntent.Change,
				update,
			}),
		);
		this.#pending = this.#pending.slice(1);
		this.#phase = { kind: SessionPhaseKind.Ready, inFlight: { operation: assigned, proposalId } };
	}

	#rebuildOverlay(): void {
		const previous = this.#overlay;
		const next = cloneCollaborativeYDoc(this.#accepted);
		const document = readCollaborativeYDoc(this.#accepted);
		let inFlight: PendingOperation | undefined;
		if (this.#phase.kind === SessionPhaseKind.Ready && this.#phase.inFlight !== undefined) {
			const partition = retainReplayable([this.#phase.inFlight.operation], document);
			inFlight = partition.retained[0];
			if (inFlight === undefined) this.#phase = { kind: SessionPhaseKind.Ready };
			for (const operation of partition.dropped) this.#emitDecision(droppedDecision(operation));
		}
		const partition = retainReplayable(this.#pending, document);
		this.#pending = partition.retained;
		if (inFlight !== undefined) applyMarkdown(next, inFlight.nodeId, inFlight.markdown);
		for (const operation of this.#pending)
			applyMarkdown(next, operation.nodeId, operation.markdown);
		for (const operation of partition.dropped) this.#emitDecision(droppedDecision(operation));
		this.#overlay = next;
		previous.destroy();
		const overlayDocument = readCollaborativeYDoc(this.#overlay);
		for (const listener of [...this.#subscribers]) listener(overlayDocument);
	}

	#emitDecision(decision: ProposalDecision): void {
		for (const listener of [...this.#decisionListeners]) listener(decision);
	}

	#assertActive(): void {
		if (this.#destroyed) throw new DocumentSessionError('Document session has been destroyed');
	}
}
