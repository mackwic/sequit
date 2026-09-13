import * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import type { DocumentSessionSubscriber } from '../document/document-session-contracts';
import {
	type SharedDocumentCommand,
	SharedElementKind,
	type SharedTarget,
} from '../document/shared-document-command';
import { type CollaborationTransport, TransportStatus } from './collaboration-transport';
import {
	CollaborationStatus,
	type CollaborativeDocumentSession,
	type ProposalDecision,
	ProposalDecisionKind,
} from './collaborative-document-session-types';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	type LocalPresence,
	type ParticipantPresence,
	type SessionMessage,
	SessionMessageKind,
} from './session-wire';
import { sharedElement } from './shared-element';
import { spliceSharedText } from './shared-text';
import { readSyncStep, SyncStepKind, writeSyncRequest, writeSyncResponse } from './sync-steps';
import { TextUpdateBuffer } from './text-update-buffer';
import { importLogicDocument, readLogicDocument } from './yjs-document-codec';

export class CollaborativeSession implements CollaborativeDocumentSession {
	readonly document = new Y.Doc();
	readonly #subscribers = new Set<DocumentSessionSubscriber>();
	readonly #decisionListeners = new Set<(decision: ProposalDecision) => void>();
	readonly #presenceListeners = new Set<(participants: readonly ParticipantPresence[]) => void>();
	readonly #rejectionListeners = new Set<(message: string) => void>();
	readonly #pending = new Map<string, readonly SharedDocumentCommand[]>();
	readonly #textOrigin = Symbol('local text');
	readonly #buffer: TextUpdateBuffer;
	readonly #stopFrames: () => void;
	readonly #stopStatus: () => void;
	#ready = false;
	#destroyed = false;
	#rejected = false;
	#initialized = false;
	#initialization: Extract<SessionMessage, { type: SessionMessageKind.Initialize }> | undefined;
	#presence: ParticipantPresence | undefined;
	#participants: readonly ParticipantPresence[] = [];

	constructor(
		private readonly initialDocument: LogicDocument,
		private readonly transport: CollaborationTransport,
	) {
		this.#buffer = new TextUpdateBuffer((update) => {
			if (this.#ready) this.#send({ type: SessionMessageKind.Change, update });
		});
		this.document.on('update', this.#updated);
		this.#stopFrames = transport.subscribeToFrames(this.#receive);
		this.#stopStatus = transport.subscribeToStatus(this.#status);
		if (transport.status() === TransportStatus.Connected) this.#startSync();
	}

	read(): LogicDocument {
		if (this.#destroyed) throw new Error('Document session has been destroyed');
		const result = readLogicDocument(this.document);
		if (result.ok) return result.value;
		return this.initialDocument;
	}

	subscribe(listener: DocumentSessionSubscriber): () => void {
		this.#subscribers.add(listener);
		return () => this.#subscribers.delete(listener);
	}

	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void {
		this.#decisionListeners.add(listener);
		return () => this.#decisionListeners.delete(listener);
	}

	subscribeToRejection(listener: (message: string) => void): () => void {
		this.#rejectionListeners.add(listener);
		return () => this.#rejectionListeners.delete(listener);
	}

	subscribeToPresence(
		listener: (participants: readonly ParticipantPresence[]) => void,
	): () => void {
		this.#presenceListeners.add(listener);
		listener(this.#participants);
		return () => this.#presenceListeners.delete(listener);
	}

	setPresence(presence: LocalPresence): void {
		this.#presence = { ...presence, clientId: this.document.clientID };
		this.#sendPresence();
	}

	connectionStatus(): CollaborationStatus {
		if (this.#rejected) return CollaborationStatus.Disconnected;
		if (this.transport.status() === TransportStatus.Disconnected)
			return CollaborationStatus.Disconnected;
		if (this.transport.status() === TransportStatus.Connecting)
			return CollaborationStatus.Connecting;
		if (this.#ready) return CollaborationStatus.Ready;
		return CollaborationStatus.Synchronizing;
	}

	dispatch(commands: readonly SharedDocumentCommand[]): string {
		if (!this.#ready || this.#rejected || this.#destroyed)
			throw new Error('La session doit être connectée.');
		const id = crypto.randomUUID();
		this.#pending.set(id, commands);
		this.#send({ type: SessionMessageKind.Change, id, commands });
		return id;
	}

	text(target: SharedTarget, field: string): Y.Text | undefined {
		try {
			const value = sharedElement(this.document, target).get(field);
			if (value instanceof Y.Text) return value;
		} catch {
			/* The target can disappear while an editor is open. */
		}
		return undefined;
	}

	applyLocalTextUpdate(update: Uint8Array): void {
		if (this.#rejected || this.#destroyed) return;
		Y.applyUpdate(this.document, update, this.#textOrigin);
	}

	updateText(target: SharedTarget, field: string, next: string): boolean {
		if (this.#destroyed || this.#rejected || !this.#initialized) return false;
		const text = this.text(target, field);
		if (text === undefined) return false;
		this.document.transact(() => {
			spliceSharedText(text, next);
		}, this.#textOrigin);
		return true;
	}

	replaceNodeMarkdown(nodeId: string, markdown: string): boolean {
		return this.updateText({ kind: SharedElementKind.Node, id: nodeId }, 'markdown', markdown);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#buffer.close();
		this.#stopFrames();
		this.#stopStatus();
		this.transport.close();
		this.document.off('update', this.#updated);
		this.document.destroy();
		this.#subscribers.clear();
		this.#decisionListeners.clear();
		this.#presenceListeners.clear();
		this.#rejectionListeners.clear();
		this.#pending.clear();
	}

	readonly #updated = (update: Uint8Array, origin: unknown): void => {
		if (origin === this.#textOrigin) this.#buffer.push(update);
		const result = readLogicDocument(this.document);
		if (!result.ok) return;
		this.#initialized = true;
		for (const subscriber of this.#subscribers) subscriber(result.value);
	};

	readonly #status = (status: TransportStatus): void => {
		if (this.#rejected || this.#destroyed) return;
		this.#ready = false;
		if (status === TransportStatus.Connected) this.#startSync();
	};

	#startSync(): void {
		this.#send({ type: SessionMessageKind.Sync, payload: writeSyncRequest(this.document) });
		this.#sendPresence();
	}

	readonly #receive = (frame: Uint8Array): void => {
		if (this.#destroyed || this.#rejected) return;
		try {
			this.#handle(decodeSessionMessage(frame));
		} catch {
			this.#reject('La session a reçu un message invalide.');
		}
	};

	#handle(message: SessionMessage): void {
		switch (message.type) {
			case SessionMessageKind.Sync:
				this.#sync(message.payload);
				return;
			case SessionMessageKind.Commit:
				Y.applyUpdate(this.document, message.update);
				this.#ready = true;
				if (message.id !== undefined) {
					this.#pending.delete(message.id);
					if (this.#initialization?.id === message.id) this.#initialization = undefined;
					for (const listener of this.#decisionListeners)
						listener({
							type: ProposalDecisionKind.Accepted,
							proposalId: message.id,
							commit: message.commit,
						});
				}
				return;
			case SessionMessageKind.Reject:
				this.#reject(message.message);
				return;
			case SessionMessageKind.Presence:
				this.#participants = message.participants;
				for (const listener of this.#presenceListeners) listener(this.#participants);
				return;
			case SessionMessageKind.Initialize:
			case SessionMessageKind.Change:
			default:
				throw new Error('Unexpected server message');
		}
	}

	#sync(payload: Uint8Array): void {
		const step = readSyncStep(payload);
		if (step.kind === SyncStepKind.Response) {
			Y.applyUpdate(this.document, step.update);
			return;
		}
		this.#send({
			type: SessionMessageKind.Sync,
			payload: writeSyncResponse(this.document, step.stateVector),
		});
		if (!this.#initialized) this.#initialize();
		else this.#initialization = undefined;
		for (const [id, commands] of this.#pending)
			this.#send({ type: SessionMessageKind.Change, id, commands });
		this.#ready = this.#initialized;
	}

	#initialize(): void {
		if (this.#initialization === undefined) {
			const initial = new Y.Doc();
			try {
				importLogicDocument(initial, this.initialDocument);
				this.#initialization = {
					type: SessionMessageKind.Initialize,
					id: crypto.randomUUID(),
					update: Y.encodeStateAsUpdate(initial),
				};
			} finally {
				initial.destroy();
			}
		}
		this.#send(this.#initialization);
	}

	#send(message: SessionMessage): void {
		if (this.#rejected || this.#destroyed) return;
		if (this.transport.status() !== TransportStatus.Connected) return;
		this.transport.send(encodeSessionMessage(message));
	}

	#sendPresence(): void {
		if (this.#presence !== undefined)
			this.#send({ type: SessionMessageKind.Presence, participants: [this.#presence] });
	}

	#reject(message: string): void {
		this.#rejected = true;
		this.#ready = false;
		this.#buffer.close();
		this.#pending.clear();
		this.transport.close();
		for (const listener of this.#rejectionListeners) listener(message);
	}
}
