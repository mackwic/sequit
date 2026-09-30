import { InvalidPresenceError } from '../../lib/infrastructure/collaboration/participant-presence';
import {
	ConflictCode,
	RetryableSessionFailure,
	SessionFailureCode,
	StaleSharedCommandError,
	TerminalSessionFailure,
} from '../../lib/infrastructure/collaboration/session-failure';
import {
	type IdentifiedTextMessage,
	SessionMessageKind,
} from '../../lib/infrastructure/collaboration/session-wire';
import type { RoomRefusalBudget } from './room-refusal-budget';
import { sendRoomMessage } from './room-sockets';

export enum RoomFailureKind {
	Retry = 'retry',
	Rejected = 'rejected',
}

export interface RoomFailureOutcome {
	readonly kind: RoomFailureKind;
	readonly code: SessionFailureCode;
	readonly message: string;
}

/** Answers the socket and reports what was sent; malformed presence is dropped silently. */
export function handleRoomFailure(
	socket: WebSocket,
	error: unknown,
	defaultCode: SessionFailureCode,
): RoomFailureOutcome | undefined {
	if (error instanceof InvalidPresenceError) return undefined;
	if (error instanceof RetryableSessionFailure) {
		sendRoomMessage(socket, {
			type: SessionMessageKind.Retry,
			code: error.code,
			message: error.message,
		});
		return { kind: RoomFailureKind.Retry, code: error.code, message: error.message };
	}
	let code = defaultCode;
	if (error instanceof TerminalSessionFailure) code = error.code;
	let message = 'La modification a été refusée.';
	if (error instanceof Error) message = error.message;
	sendRoomMessage(socket, { type: SessionMessageKind.Reject, code, message });
	socket.close(1008, 'Change rejected');
	return { kind: RoomFailureKind.Rejected, code, message };
}

export function commandConflictCode(
	error: unknown,
): ConflictCode.CommandConflict | ConflictCode.InvalidCommand {
	if (error instanceof StaleSharedCommandError) return ConflictCode.CommandConflict;
	return ConflictCode.InvalidCommand;
}

export function refuseTextTarget(
	socket: WebSocket,
	message: IdentifiedTextMessage,
	budget: RoomRefusalBudget,
): void {
	if (!budget.allow(socket, message.id))
		throw new TerminalSessionFailure(
			SessionFailureCode.RepeatedCommandRefusal,
			'Cette proposition a été refusée trop souvent.',
		);
	sendRoomMessage(socket, {
		type: SessionMessageKind.Conflict,
		code: ConflictCode.TextTargetGone,
		message: 'La cible de texte a été supprimée ou remplacée.',
		id: message.id,
		target: message.target,
	});
}
