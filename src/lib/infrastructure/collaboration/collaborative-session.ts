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
	type SourceDocumentState,
	SourceDocumentStateKind,
} from './collaborative-document-session-types';
import { notifySubscribers, subscribeToSet } from './notify-subscribers';
import { prepareSessionCommand } from './session-command-frame';
import { recoverSessionConflict } from './session-conflict-recovery';
import { ConflictCode } from './session-failure';
import {
	announceAcceptedReceipt,
	createInitializationMessage,
	createTextProposalBuffer,
	handleIncomingMessage,
	receiveSessionFrame,
	resolveCommitReceipt,
} from './session-incoming';
import { SessionPresence } from './session-presence';
import { SessionSynchronizer } from './session-synchronizer';
import {
	encodeSessionMessage,
	type LocalPresence,
	type ParticipantPresence,
	type SessionMessage,
	SessionMessageKind,
} from './session-wire';
import { readSessionSourceState } from './source-document-state';
import { sharedTextAt, TextIntentLedger } from './text-intent-ledger';
import type { TextUpdateBuffer } from './text-update-buffer';
import { readLogicDocument } from './yjs-document-codec';

export class CollaborativeSession implements CollaborativeDocumentSession {
	document = new Y.Doc();
	readonly #subscribers = new Set<DocumentSessionSubscriber>();
	readonly #sourceStateListeners = new Set<(state: SourceDocumentState) => void>();
	readonly #decisionListeners = new Set<(decision: ProposalDecision) => void>();
	readonly #rejectionListeners = new Set<(message: string) => void>();
	readonly #conflictListeners = new Set<(message: string) => void>();
	readonly #pending = new Map<string, Uint8Array>();
	readonly #textFrames = new Set<string>();
	readonly #intents = new TextIntentLedger();
	#restoring = false;
	readonly #textOrigin = Symbol('local text');
	readonly #sessionId = crypto.randomUUID();
	#sequence = 0;
	#sourceState: SourceDocumentState;
	#buffer: TextUpdateBuffer;
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
		this.#presence = new SessionPresence(
			() => this.document.clientID,
			(message) => {
				this.#send(message);
			},
		);
		this.#buffer = this.#createBuffer();
		this.#sourceState = { kind: SourceDocumentStateKind.Uninitialized, revision: 0 };
		this.#synchronizer = new SessionSynchronizer({
			document: () => this.document,
			initialized: () => this.#initialized,
			restoring: () => this.#restoring,
			intents: this.#intents,
			buffer: () => this.#buffer,
			pending: this.#pending,
			send: (message) => {
				this.#send(message);
			},
			replay: (frame) => {
				this.transport.send(frame);
			},
			initialize: () => {
				this.#initialize();
			},
			clearInitialization: () => {
				this.#initialization = undefined;
			},
			setRestoring: (value) => {
				this.#restoring = value;
			},
			setReady: (value) => {
				this.#ready = value;
			},
			notifyDraft: (message) => {
				notifySubscribers(this.#conflictListeners, message);
			},
			terminal: (message) => {
				this.#reject(message);
			},
			presence: () => {
				this.#presence.send();
			},
		});
		this.document.on('update', this.#updated);
		this.#stopFrames = transport.subscribeToFrames(this.#receive);
		this.#stopStatus = transport.subscribeToStatus(this.#status);
		if (transport.status() === TransportStatus.Connected) this.#synchronizer.start();
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
		return subscribeToSet(this.#subscribers, listener);
	}

	subscribeToSourceState(listener: (state: SourceDocumentState) => void): () => void {
		return subscribeToSet(this.#sourceStateListeners, listener);
	}

	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void {
		return subscribeToSet(this.#decisionListeners, listener);
	}

	subscribeToRejection(listener: (message: string) => void): () => void {
		return subscribeToSet(this.#rejectionListeners, listener);
	}

	subscribeToConflict(listener: (message: string) => void): () => void {
		return subscribeToSet(this.#conflictListeners, listener);
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
		const { id, sequence, frame } = prepareSessionCommand(
			commands,
			this.#sessionId,
			this.#sequence,
		);
		// Invalid local commands cannot consume a sequence; retain the exact frame for retries.
		// Preserve gesture order: a deletion must not overtake buffered edits to its target.
		this.#buffer.flush();
		this.#sequence = sequence;
		this.#pending.set(id, frame);
		this.transport.send(frame);
		return id;
	}

	text(target: SharedTarget, field: string): Y.Text | undefined {
		return sharedTextAt(this.document, target, field);
	}

	applyLocalTextUpdate(update: Uint8Array): void {
		if (this.#rejected || this.#destroyed) return;
		this.#intents.applyComposition(this.document, update, this.#textOrigin);
	}

	updateText(target: SharedTarget, field: string, next: string): boolean {
		if (this.#destroyed || this.#rejected || !this.#initialized) return false;
		return this.#intents.edit(this.document, { target, field, next, origin: this.#textOrigin });
	}

	replaceNodeMarkdown(nodeId: string, markdown: string): boolean {
		return this.updateText({ kind: SharedElementKind.Node, id: nodeId }, 'markdown', markdown);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#buffer.close();
		this.#presence.destroy();
		this.#synchronizer.stop();
		this.#stopFrames();
		this.#stopStatus();
		this.transport.close();
		this.document.off('update', this.#updated);
		this.document.destroy();
		this.#subscribers.clear();
		this.#sourceStateListeners.clear();
		this.#decisionListeners.clear();
		this.#rejectionListeners.clear();
		this.#conflictListeners.clear();
		this.#pending.clear();
		this.#textFrames.clear();
		this.#intents.clear();
	}

	readonly #updated = (update: Uint8Array, origin: unknown): void => {
		if (origin === this.#textOrigin) this.#buffer.push(update);
		this.#sourceState = readSessionSourceState(this.document, this.#sourceState, this.#initialized);
		const state = this.#sourceState;
		if (state.kind === SourceDocumentStateKind.Valid) this.#initialized = true;
		notifySubscribers(this.#sourceStateListeners, state);
		if (state.kind === SourceDocumentStateKind.Valid)
			notifySubscribers(this.#subscribers, state.document);
	};

	readonly #status = (status: TransportStatus): void => {
		if (this.#rejected || this.#destroyed) return;
		this.#ready = false;
		if (status === TransportStatus.Connected) this.#synchronizer.start();
		else this.#presence.receive([]);
	};

	readonly #receive = (frame: Uint8Array): void => {
		if (this.#destroyed || this.#rejected) return;
		if (
			!receiveSessionFrame(frame, (message) => {
				this.#handle(message);
			})
		)
			this.#reject('La session a reçu un message invalide.');
	};

	#handle(message: SessionMessage): void {
		handleIncomingMessage(message, {
			document: this.document,
			onSync: (payload) => {
				this.#synchronizer.receive(payload);
			},
			onCommit: (id, commit) => {
				const receipt = resolveCommitReceipt(
					id,
					this.#pending,
					this.#textFrames,
					this.#initialization?.id,
				);
				if (receipt.acknowledged) this.#synchronizer.acknowledge();
				if (this.#synchronizer.attempts === 0) this.#ready = true;
				if (receipt.initialization) this.#initialization = undefined;
				if (receipt.decision && id !== undefined)
					announceAcceptedReceipt(this.#decisionListeners, id, commit);
			},
			onReject: (reason) => {
				this.#reject(reason);
			},
			onConflict: (conflict) => {
				this.#conflict(conflict);
			},
			onRetry: (reason) => {
				this.#synchronizer.retry(reason);
			},
			onPresence: (participants) => {
				this.#presence.receive(participants);
			},
		});
	}

	#createBuffer(): TextUpdateBuffer {
		return createTextProposalBuffer(
			() => this.#ready,
			() => this.#intents.targets(),
			(message) => {
				if (message.type === SessionMessageKind.Change && 'update' in message) {
					if (message.id !== undefined) this.#textFrames.add(message.id);
				}
				this.#send(message);
			},
		);
	}

	#conflict(message: Extract<SessionMessage, { type: SessionMessageKind.Conflict }>): void {
		if (message.code === ConflictCode.TextTargetGone && message.id !== undefined) {
			if (!this.#textFrames.delete(message.id)) return;
		}
		const recovered = recoverSessionConflict({
			message,
			pending: this.#pending,
			sequence: this.#sequence,
			document: this.document,
			buffer: this.#buffer,
			onUpdate: this.#updated,
			createBuffer: () => this.#createBuffer(),
		});
		if (recovered === undefined) return;
		this.#sequence = recovered.sequence;
		this.document = recovered.document;
		this.#buffer = recovered.buffer;
		this.#restoring = recovered.restoring;
		this.#ready = false;
		if (recovered.restoring) this.#presence.remount();
		if (recovered.decision !== undefined)
			notifySubscribers(this.#decisionListeners, recovered.decision);
		notifySubscribers(this.#conflictListeners, recovered.notice);
		this.#synchronizer.start();
	}

	#initialize(): void {
		this.#initialization ??= createInitializationMessage(this.initialDocument);
		this.#send(this.#initialization);
	}

	#send(message: SessionMessage): void {
		if (this.#rejected || this.#destroyed) return;
		if (this.transport.status() !== TransportStatus.Connected) return;
		this.transport.send(encodeSessionMessage(message));
	}

	#reject(message: string): void {
		this.#rejected = true;
		this.#ready = false;
		this.#buffer.close();
		this.#presence.destroy();
		this.#synchronizer.stop();
		this.#pending.clear();
		this.transport.close();
		notifySubscribers(this.#rejectionListeners, message);
	}
}
