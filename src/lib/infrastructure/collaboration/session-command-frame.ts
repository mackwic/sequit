import type { SharedDocumentCommand } from '../document/shared-document-command';
import { encodeSessionMessage, SessionMessageKind } from './session-wire';

interface PendingCommandFrame {
	readonly id: string;
	readonly sequence: number;
	readonly frame: Uint8Array;
}

/** Validate and encode before consuming a durable command sequence. */
export function prepareSessionCommand(
	commands: readonly SharedDocumentCommand[],
	sessionId: string,
	acceptedSequence: number,
): PendingCommandFrame {
	const id = crypto.randomUUID();
	const sequence = acceptedSequence + 1;
	const frame = encodeSessionMessage({
		type: SessionMessageKind.Change,
		id,
		sessionId,
		sequence,
		commands,
	});
	return { id, sequence, frame };
}
