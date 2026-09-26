import type { SharedDocumentCommand } from '../document/shared-document-command';
import { encodeSessionMessage, type SessionMessage, SessionMessageKind } from './session-wire';

export interface PendingCommandFrame {
	readonly id: string;
	sequence: number;
	frame: Uint8Array;
	message: Extract<SessionMessage, { type: SessionMessageKind.Change; commands: unknown }>;
}

/** Validate and encode before consuming a durable command sequence. */
export function prepareSessionCommand(
	commands: readonly SharedDocumentCommand[],
	sessionId: string,
	acceptedSequence: number,
): PendingCommandFrame {
	const id = crypto.randomUUID();
	const sequence = acceptedSequence + 1;
	const message = {
		type: SessionMessageKind.Change,
		id,
		sessionId,
		sequence,
		commands,
	} as const;
	const frame = encodeSessionMessage(message);
	return { id, sequence, frame, message };
}
