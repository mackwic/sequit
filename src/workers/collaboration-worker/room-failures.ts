import { InvalidPresenceError } from '../../lib/infrastructure/collaboration/participant-presence';
import {
	RetryableSessionFailure,
	SessionConflict,
	type SessionFailureCode,
	TerminalSessionFailure,
} from '../../lib/infrastructure/collaboration/session-failure';
import { SessionMessageKind } from '../../lib/infrastructure/collaboration/session-wire';
import { sendRoomMessage } from './room-sockets';

export function handleRoomFailure(
	socket: WebSocket,
	error: unknown,
	defaultCode: SessionFailureCode,
): void {
	if (error instanceof InvalidPresenceError) return;
	if (error instanceof SessionConflict) {
		const conflict: {
			type: SessionMessageKind.Conflict;
			code: typeof error.code;
			message: string;
			targetId?: string;
		} = {
			type: SessionMessageKind.Conflict,
			code: error.code,
			message: error.message,
		};
		if (error.targetId !== undefined) conflict.targetId = error.targetId;
		sendRoomMessage(socket, conflict);
		return;
	}
	if (error instanceof RetryableSessionFailure) {
		sendRoomMessage(socket, {
			type: SessionMessageKind.Retry,
			code: error.code,
			message: error.message,
		});
		return;
	}
	let code = defaultCode;
	if (error instanceof TerminalSessionFailure) code = error.code;
	let message = 'La modification a été refusée.';
	if (error instanceof Error) message = error.message;
	sendRoomMessage(socket, { type: SessionMessageKind.Reject, code, message });
	socket.close(1008, 'Change rejected');
}
