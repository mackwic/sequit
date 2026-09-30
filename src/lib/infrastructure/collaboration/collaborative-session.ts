import * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import type { DocumentCommandOutcome } from '../document/document-command-contracts';
import {
	type SharedDocumentCommand,
	SharedElementKind,
	type SharedTarget,
} from '../document/shared-document-command';
import { type CollaborationTransport, TransportStatus } from './collaboration-transport';
import {
	type CollaborationStatus,
	type CollaborativeDocumentSession,
	type SourceDocumentState,
	SourceDocumentStateKind,
} from './collaborative-document-session-types';
import { notifySubscribers } from './notify-subscribers';
import { prepareSessionCommand } from './session-command-frame';
import { recoverSessionCommandConflict } from './session-conflict-recovery';
import { connectionStatus } from './session-connection-status';
import { ConflictCode } from './session-failure';
import {
	createInitializationMessage,
	handleIncomingMessage,
	receiveSessionFrame,
	resolveCommitReceipt,
} from './session-incoming';
import { SessionNotifications } from './session-notifications';
import { SessionPresence } from './session-presence';
import { replaceReplicaAfterTextRefusal } from './session-replica-recovery';
import { SessionSynchronizer } from './session-synchronizer';
import { SessionTextFlow } from './session-text-edits';
import {
	encodeSessionMessage,
	type LocalPresence,
	type ParticipantPresence,
	type SessionMessage,
	type SessionMessageKind,
} from './session-wire';
import { sharedTextAt } from './shared-element';
import { spliceSharedText } from './shared-text';
import { readSessionSourceState } from './source-document-state';
import { readLogicDocument } from './yjs-document-codec';

export class CollaborativeSession
	extends SessionNotifications
	implements CollaborativeDocumentSession
{
	document = new Y.Doc();
	#replica = 0;
	#textFlow: SessionTextFlow;
	#resumingText = false;
	#recoveringTextRefusal = false;
	readonly #textOrigin = Symbol('local text');
	readonly #sessionId = crypto.randomUUID();
	#sequence = 0;
	#sourceState: SourceDocumentState;
	readonly #synchronizer: SessionSynchronizer;
	readonly #stopFrames: () => void;
	readonly #stopStatus: () => void;
	#ready = false;
	#destroyed = false;
	#rejected = false;
	#initialized = false;
	#initialization: Extract<SessionMessage, { type: SessionMessageKind.Initialize }> | undefined;
	readonly #presence: SessionPresence;

	constructor(
		private readonly initialDocument: LogicDocument,
		private readonly transport: CollaborationTransport,
	) {
		super();
		this.#presence = new SessionPresence(
			() => this.document.clientID,
			(message) => {
				this.#send(message);
			},
		);
		this.#textFlow = this.#createTextFlow();
		this.#sourceState = { kind: SourceDocumentStateKind.Uninitialized, revision: 0 };
		this.#synchronizer = new SessionSynchronizer({
			document: () => this.document,
			initialized: () => this.#initialized,
			buffer: () => this.#textFlow.buffer,
			pending: this.pending,
			send: (message) => {
				this.#send(message);
			},
			replay: (frame) => {
				this.transport.send(frame);
			},
			initialize: () => {
				this.#initialization ??= createInitializationMessage(this.initialDocument);
				this.#send(this.#initialization);
			},
			clearInitialization: () => {
				this.#initialization = undefined;
			},
			setReady: (value) => {
				this.#ready = value;
				if (value) this.#recoveringTextRefusal = false;
			},
			terminal: (message) => {
				this.#reject(message);
			},
			presence: () => {
				this.#presence.send();
			},
			resumeText: (retry) => {
				if (this.#resumingText && !retry) return true;
				this.#resumingText = true;
				if (this.#textFlow.resume()) return true;
				this.#resumingText = false;
				return false;
			},
		});
		this.document.on('update', this.#updated);
		this.#stopFrames = transport.subscribeToFrames(this.#receive);
		this.#stopStatus = transport.subscribeToStatus(this.#status);
		if (transport.status() === TransportStatus.Connected) this.#synchronizer.start();
	}

	replica(): number {
		return this.#replica;
	}

	read(): LogicDocument {
		if (this.#destroyed) throw new Error('Document session has been destroyed');
		const result = readLogicDocument(this.document);
		if (result.ok) return result.value;
		return this.initialDocument;
	}

	readSourceState(): SourceDocumentState {
		if (this.#destroyed) throw new Error('Document session has been destroyed');
		return this.#sourceState;
	}

	subscribeToPresence(
		listener: (participants: readonly ParticipantPresence[]) => void,
	): () => void {
		return this.#presence.subscribe(listener);
	}

	setPresence(presence: Partial<LocalPresence>): void {
		if (this.#destroyed || this.#rejected) return;
		this.#presence.update(presence);
	}

	connectionStatus(): CollaborationStatus {
		return connectionStatus(this.#rejected, this.transport.status(), this.#ready);
	}

	dispatch(commands: readonly SharedDocumentCommand[]): Promise<DocumentCommandOutcome> {
		if (!this.#ready || this.#rejected || this.#destroyed)
			throw new Error('La session doit être connectée.');
		const pending = prepareSessionCommand(commands, this.#sessionId, this.#sequence);
		// Validate before consuming a sequence; flush text before deleting its target.
		this.#textFlow.buffer.flush();
		this.#sequence = pending.sequence;
		const decision = this.propose(pending);
		this.transport.send(pending.frame);
		return decision;
	}

	text(target: SharedTarget, field: string): Y.Text | undefined {
		return sharedTextAt(this.document, target, field);
	}

	applyLocalTextUpdate(
		target: SharedTarget,
		field: string,
		update: Uint8Array,
		bound?: Y.Text,
	): void {
		if (!this.#canEditText()) return;
		const text = sharedTextAt(this.document, target, field);
		if (!this.#textFlow.boundText(target, text, bound)) return;
		this.#textFlow.prepare(target, field, text);
		Y.applyUpdate(this.document, update, this.#textOrigin);
	}

	updateText(target: SharedTarget, field: string, next: string, bound?: Y.Text): boolean {
		if (!this.#canEditText()) return false;
		const text = sharedTextAt(this.document, target, field);
		if (!this.#textFlow.boundText(target, text, bound)) return false;
		if (text.toJSON() === next) return true;
		this.#textFlow.prepare(target, field, text);
		this.document.transact(() => {
			spliceSharedText(text, next);
		}, this.#textOrigin);
		return true;
	}

	#canEditText(): boolean {
		if (this.#rejected || this.#destroyed || this.#recoveringTextRefusal) return false;
		return this.#initialized;
	}

	replaceNodeMarkdown(nodeId: string, markdown: string): boolean {
		return this.updateText({ kind: SharedElementKind.Node, id: nodeId }, 'markdown', markdown);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#textFlow.close();
		this.#presence.destroy();
		this.#synchronizer.stop();
		this.#stopFrames();
		this.#stopStatus();
		this.transport.close();
		this.document.off('update', this.#updated);
		this.document.destroy();
		this.clearNotifications();
		this.closeProposals();
	}

	readonly #updated = (update: Uint8Array, origin: unknown): void => {
		if (origin === this.#textOrigin) this.#textFlow.buffer.push(update);
		this.#sourceState = readSessionSourceState(this.document, this.#sourceState, this.#initialized);
		if (this.#sourceState.kind === SourceDocumentStateKind.Valid) this.#initialized = true;
		notifySubscribers(this.sourceStateListeners, this.#sourceState);
		if (this.#sourceState.kind === SourceDocumentStateKind.Valid)
			notifySubscribers(this.subscribers, this.#sourceState.document);
	};

	readonly #status = (status: TransportStatus): void => {
		if (this.#rejected || this.#destroyed) return;
		this.#ready = false;
		if (status === TransportStatus.Connected) {
			this.#resumingText = true;
			if (!this.#textFlow.resume()) this.#sendNextPendingText();
		} else {
			this.#resumingText = false;
			this.#presence.receive([]);
		}
	};

	readonly #receive = (frame: Uint8Array): void => {
		if (this.#destroyed || this.#rejected) return;
		if (!receiveSessionFrame(frame, this.#handle))
			this.#reject('La session a reçu un message invalide.');
	};

	readonly #handle = (message: SessionMessage): void => {
		handleIncomingMessage(message, {
			document: this.document,
			onSync: (payload) => {
				this.#synchronizer.receive(payload);
			},
			onCommit: (id, commit) => {
				const receipt = resolveCommitReceipt(
					id,
					this.pending,
					this.#textFlow.edits,
					this.#initialization?.id,
				);
				if (receipt.acknowledged) this.#synchronizer.acknowledge();
				const textAccepted = id !== undefined && this.#textFlow.pending.delete(id);
				if (textAccepted && this.#resumingText) this.#sendNextPendingText();
				else if (textAccepted) this.#textFlow.sendNext();
				const synchronized = this.#initialized && !this.#resumingText;
				if (synchronized && this.#synchronizer.attempts === 0) this.#ready = true;
				if (receipt.initialization) this.#initialization = undefined;
				if (receipt.decision && id !== undefined) this.announceAccepted(id, commit);
			},
			onReject: (reason) => {
				this.#reject(reason);
			},
			onConflict: (conflict) => {
				this.#conflict(conflict);
			},
			onRetry: (reason) => {
				if (this.#textFlow.pending.size > 0 || this.#textFlow.buffer.hasPending())
					this.#resumingText = true;
				this.#synchronizer.retry(reason);
			},
			onPresence: (participants) => {
				this.#presence.receive(participants);
			},
		});
	};

	#createTextFlow(): SessionTextFlow {
		return new SessionTextFlow(
			this.#sessionId,
			() => this.#ready && !this.#resumingText,
			this.#send.bind(this),
			this.conflictListeners,
		);
	}

	#sendNextPendingText(): void {
		if (this.#textFlow.sendNext()) return;
		this.#resumingText = false;
		this.#synchronizer.start();
	}

	#conflict(message: Extract<SessionMessage, { type: SessionMessageKind.Conflict }>): void {
		if (message.code === ConflictCode.TextTargetGone) {
			if (this.#textFlow.pending.has(message.id)) this.#resetReplica();
			return;
		}
		const recovered = recoverSessionCommandConflict(message, this.pending);
		if (recovered === undefined) return;
		this.#sequence = recovered.sequence;
		this.#ready = false;
		this.announceDecision(recovered.decision);
		notifySubscribers(this.conflictListeners, recovered.notice);
		this.#synchronizer.start();
	}

	#resetReplica(): void {
		this.#ready = false;
		this.#recoveringTextRefusal = true;
		this.#resumingText = false;
		this.#synchronizer.stop();
		const reset = replaceReplicaAfterTextRefusal(
			this.document,
			this.#sourceState,
			this.#textFlow,
			this.#updated,
		);
		this.document = reset.document;
		this.#sourceState = reset.sourceState;
		this.#textFlow = this.#createTextFlow();
		this.#initialized = false;
		this.#replica++;
		notifySubscribers(this.sourceStateListeners, reset.sourceState);
		notifySubscribers(this.conflictListeners, reset.notice);
		this.#synchronizer.start();
	}

	#send(message: SessionMessage): void {
		if (this.#rejected || this.#destroyed) return;
		if (this.transport.status() !== TransportStatus.Connected) return;
		this.transport.send(encodeSessionMessage(message));
	}

	#reject(message: string): void {
		this.#rejected = true;
		this.#textFlow.close();
		this.#presence.destroy();
		this.#synchronizer.stop();
		this.closeProposals();

		this.transport.close();
		notifySubscribers(this.rejectionListeners, message);
	}
}
