import * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import type { SharedDocumentCommand } from '../document/shared-document-command';
import { InvalidPresenceError } from './participant-presence';
import type { PendingCommandFrame } from './session-command-frame';
import type { SessionRejection } from './session-reasons';
import {
	decodeSessionMessage,
	type ParticipantPresence,
	type SessionMessage,
	SessionMessageKind,
} from './session-wire';
import { importLogicDocument } from './yjs-document-codec';

interface IncomingHandlers {
	readonly document: Y.Doc;
	readonly onSync: (payload: Uint8Array) => void;
	readonly onCommit: (id: string | undefined, commit: number) => void;
	readonly onReject: (reason: SessionRejection) => void;
	readonly onConflict: (
		message: Extract<SessionMessage, { type: SessionMessageKind.Conflict }>,
	) => void;
	readonly onRetry: (reason: SessionRejection) => void;
	readonly onPresence: (participants: readonly ParticipantPresence[]) => void;
}

export function handleIncomingMessage(message: SessionMessage, handlers: IncomingHandlers): void {
	switch (message.type) {
		case SessionMessageKind.Sync:
			handlers.onSync(message.payload);
			return;
		case SessionMessageKind.Commit:
			Y.applyUpdate(handlers.document, message.update);
			handlers.onCommit(message.id, message.commit);
			return;
		case SessionMessageKind.Reject:
			handlers.onReject(message.reason);
			return;
		case SessionMessageKind.Conflict:
			handlers.onConflict(message);
			return;
		case SessionMessageKind.Retry:
			handlers.onRetry(message.reason);
			return;
		case SessionMessageKind.Presence:
			handlers.onPresence(message.participants);
			return;
		case SessionMessageKind.Initialize:
		case SessionMessageKind.Change:
		default:
			throw new Error('Unexpected server message');
	}
}

export function createInitializationMessage(
	document: LogicDocument,
): Extract<SessionMessage, { type: SessionMessageKind.Initialize }> {
	const initial = new Y.Doc();
	try {
		importLogicDocument(initial, document);
		return {
			type: SessionMessageKind.Initialize,
			id: crypto.randomUUID(),
			update: Y.encodeStateAsUpdate(initial),
		};
	} finally {
		initial.destroy();
	}
}

export function sendPresenceSafely(
	presence: ParticipantPresence | undefined,
	send: (message: SessionMessage) => void,
): void {
	if (presence === undefined) return;
	try {
		send({ type: SessionMessageKind.Presence, participants: [presence] });
	} catch {
		// Ephemeral presence must not interrupt document edits.
	}
}

export interface CommitReceipt {
	readonly acknowledged: boolean;
	readonly decision: boolean;
	readonly initialization: boolean;
	/** The batch this session proposed, when the commit accepts one. */
	readonly commands?: readonly SharedDocumentCommand[];
}

interface TextReceiptAcknowledgments {
	acknowledge(id: string): boolean;
}

export function resolveCommitReceipt(
	id: string | undefined,
	pending: Map<string, PendingCommandFrame>,
	textEdits: TextReceiptAcknowledgments,
	initializationId?: string,
): CommitReceipt {
	if (id === undefined) return { acknowledged: false, decision: false, initialization: false };
	if (textEdits.acknowledge(id))
		return { acknowledged: true, decision: false, initialization: false };
	const proposal = pending.get(id);
	pending.delete(id);
	const initialization = initializationId === id;
	const decided = proposal !== undefined || initialization;
	const receipt = { acknowledged: decided, decision: decided, initialization };
	if (proposal === undefined) return receipt;
	return { ...receipt, commands: proposal.message.commands };
}

export function clearSessionTimer(timer: ReturnType<typeof setTimeout> | null): null {
	if (timer !== null) clearTimeout(timer);
	return null;
}

/** Presence corruption is ephemeral; all other invalid frames are terminal. */
export function receiveSessionFrame(
	frame: Uint8Array,
	handle: (message: SessionMessage) => void,
): boolean {
	try {
		handle(decodeSessionMessage(frame));
		return true;
	} catch (error) {
		return error instanceof InvalidPresenceError;
	}
}
