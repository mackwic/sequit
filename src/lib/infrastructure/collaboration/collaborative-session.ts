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
	type SourceDocumentState,
	SourceDocumentStateKind,
} from './collaborative-document-session-types';
import { notifySubscribers } from './notify-subscribers';
import { InvalidPresenceError } from './participant-presence';
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
import { readSourceDocumentState } from './source-document-state';
import { readSyncStep, SyncStepKind, writeSyncRequest, writeSyncResponse } from './sync-steps';
import { TextUpdateBuffer } from './text-update-buffer';
import { importLogicDocument, readLogicDocument } from './yjs-document-codec';

export class CollaborativeSession implements CollaborativeDocumentSession {
	readonly document = new Y.Doc();
	readonly #subscribers = new Set<DocumentSessionSubscriber>();
	readonly #sourceStateListeners = new Set<(state: SourceDocumentState) => void>();
	readonly #decisionListeners = new Set<(decision: ProposalDecision) => void>();
	readonly #presenceListeners = new Set<(participants: readonly ParticipantPresence[]) => void>();
	readonly #rejectionListeners = new Set<(message: string) => void>();
	readonly #pending = new Map<string, Uint8Array>();
	readonly #textOrigin = Symbol('local text');
	readonly #sessionId = crypto.randomUUID();
	#sequence = 0;
	#sourceState: SourceDocumentState;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #buffer: TextUpdateBuffer;
	readonly #stopFrames: () => void;
	readonly #stopStatus: () => void;
	#ready = false;
	#destroyed = false;
	#rejected = false;
	#initialized = false;
	#initialization: Extract<SessionMessage, { type: SessionMessageKind.Initialize }> | undefined;
	#presence: ParticipantPresence | undefined;
	#presenceTimer: ReturnType<typeof setTimeout> | undefined;
	#participants: readonly ParticipantPresence[] = [];

	constructor(
		private readonly initialDocument: LogicDocument,
		private readonly transport: CollaborationTransport,
	) {
		this.#buffer = new TextUpdateBuffer((update) => {
			if (this.#ready) this.#send({ type: SessionMessageKind.Change, update });
		});
		this.#sourceState = { kind: SourceDocumentStateKind.Uninitialized, revision: 0 };
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

	readSourceState(): SourceDocumentState {
		if (this.#destroyed) throw new Error('Document session has been destroyed');
		return this.#sourceState;
	}

	subscribe(listener: DocumentSessionSubscriber): () => void {
		this.#subscribers.add(listener);
		return () => this.#subscribers.delete(listener);
	}

	subscribeToSourceState(listener: (state: SourceDocumentState) => void): () => void {
		this.#sourceStateListeners.add(listener);
		return () => this.#sourceStateListeners.delete(listener);
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
		notifySubscribers([listener], this.#participants);
		return () => this.#presenceListeners.delete(listener);
	}

	setPresence(presence: Partial<LocalPresence>): void {
		if (this.#destroyed || this.#rejected) return;
		this.#presence = {
			name: 'Participant',
			color: '#6f70e8',
			selected: [],
			...this.#presence,
			...presence,
			clientId: this.document.clientID,
		};
		this.#presenceTimer ??= setTimeout(() => {
			this.#sendPresence();
		}, 50);
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
		const sequence = this.#sequence + 1;
		const frame = encodeSessionMessage({
			type: SessionMessageKind.Change,
			id,
			sessionId: this.#sessionId,
			sequence,
			commands,
		});
		// Invalid local commands cannot consume a sequence; retain the exact frame for retries.
		// Preserve gesture order: a deletion must not overtake buffered edits to its target.
		this.#buffer.flush();
		this.#sequence = sequence;
		this.#pending.set(id, frame);
		this.transport.send(frame);
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
		this.#clearPresenceTimer();
		this.#clearRetryTimer();
		this.#stopFrames();
		this.#stopStatus();
		this.transport.close();
		this.document.off('update', this.#updated);
		this.document.destroy();
		this.#subscribers.clear();
		this.#sourceStateListeners.clear();
		this.#decisionListeners.clear();
		this.#presenceListeners.clear();
		this.#rejectionListeners.clear();
		this.#pending.clear();
	}

	readonly #updated = (update: Uint8Array, origin: unknown): void => {
		if (origin === this.#textOrigin) this.#buffer.push(update);
		const revision = this.#sourceState.revision + 1;
		const decoded = readSourceDocumentState(this.document, revision);
		if (!this.#initialized && decoded.kind === SourceDocumentStateKind.Invalid)
			this.#sourceState = {
				kind: SourceDocumentStateKind.Uninitialized,
				revision,
			};
		else this.#sourceState = decoded;
		const state = this.#sourceState;
		if (state.kind === SourceDocumentStateKind.Valid) this.#initialized = true;
		notifySubscribers(this.#sourceStateListeners, state);
		if (state.kind !== SourceDocumentStateKind.Valid) return;
		notifySubscribers(this.#subscribers, state.document);
	};

	readonly #status = (status: TransportStatus): void => {
		if (this.#rejected || this.#destroyed) return;
		this.#ready = false;
		if (status === TransportStatus.Connected) this.#startSync();
		else {
			this.#participants = [];
			notifySubscribers(this.#presenceListeners, this.#participants);
		}
	};

	#startSync(): void {
		this.#clearRetryTimer();
		this.#send({ type: SessionMessageKind.Sync, payload: writeSyncRequest(this.document) });
		this.#sendPresence();
	}

	readonly #receive = (frame: Uint8Array): void => {
		if (this.#destroyed || this.#rejected) return;
		try {
			this.#handle(decodeSessionMessage(frame));
		} catch (error) {
			if (error instanceof InvalidPresenceError) return;
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
					notifySubscribers(this.#decisionListeners, {
						type: ProposalDecisionKind.Accepted,
						proposalId: message.id,
						commit: message.commit,
					});
				}
				return;
			case SessionMessageKind.Reject:
				this.#reject(message.message);
				return;
			case SessionMessageKind.Retry:
				this.#ready = false;
				this.#retryTimer ??= setTimeout(() => {
					this.#startSync();
				}, 1_000);
				return;
			case SessionMessageKind.Presence:
				this.#participants = message.participants;
				notifySubscribers(this.#presenceListeners, this.#participants);
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
		for (const frame of this.#pending.values()) this.transport.send(frame);
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

	#clearRetryTimer(): void {
		if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
	}

	#clearPresenceTimer(): void {
		if (this.#presenceTimer !== undefined) clearTimeout(this.#presenceTimer);
		this.#presenceTimer = undefined;
	}

	#sendPresence(): void {
		this.#clearPresenceTimer();
		if (this.#presence !== undefined)
			try {
				this.#send({ type: SessionMessageKind.Presence, participants: [this.#presence] });
			} catch {
				/* Invalid ephemeral presence must not interrupt document edits. */
			}
	}

	#reject(message: string): void {
		this.#rejected = true;
		this.#ready = false;
		this.#buffer.close();
		this.#clearPresenceTimer();
		this.#clearRetryTimer();
		this.#pending.clear();
		this.transport.close();
		notifySubscribers(this.#rejectionListeners, message);
	}
}
