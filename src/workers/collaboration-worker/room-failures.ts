import { InvalidPresenceError } from '../../lib/infrastructure/collaboration/participant-presence';
import {
	RetryableSessionFailure,
	StaleSharedCommandError,
	TerminalSessionFailure,
} from '../../lib/infrastructure/collaboration/session-failure';
import {
	ConflictCode,
	SessionFailureCode,
	type SessionRejection,
} from '../../lib/infrastructure/collaboration/session-reasons';
import {
	type IdentifiedTextMessage,
	SessionMessageKind,
} from '../../lib/infrastructure/collaboration/session-wire';
import type { RoomRefusalBudget } from './room-refusal-budget';
import { sendRoomMessage } from './room-sockets';

enum RoomFailureKind {
	Retry = 'retry',
	Rejected = 'rejected',
}

function rejectionFor(
	code: SessionFailureCode.InvalidMessage | SessionFailureCode.InvalidDocument,
	details: readonly string[],
): SessionRejection {
	if (code === SessionFailureCode.InvalidMessage)
		return { code: SessionFailureCode.InvalidMessage, details };
	return { code: SessionFailureCode.InvalidDocument, details };
}

export interface RoomFailureOutcome {
	readonly kind: RoomFailureKind;
	readonly code: SessionFailureCode;
	readonly reason: SessionRejection;
}

/** Answers the socket and reports what was sent; malformed presence is dropped silently. */
export function handleRoomFailure(
	socket: WebSocket,
	error: unknown,
	defaultCode: SessionFailureCode.InvalidMessage | SessionFailureCode.InvalidDocument,
): RoomFailureOutcome | undefined {
	if (error instanceof InvalidPresenceError) return undefined;
	if (error instanceof RetryableSessionFailure) {
		sendRoomMessage(socket, {
			type: SessionMessageKind.Retry,
			code: error.code,
			reason: error.reason,
		});
		return { kind: RoomFailureKind.Retry, code: error.code, reason: error.reason };
	}
	let reason: SessionRejection;
	if (error instanceof TerminalSessionFailure) reason = error.reason;
	else if (error instanceof Error) reason = rejectionFor(defaultCode, [error.message]);
	else reason = rejectionFor(defaultCode, ['Unknown session failure.']);
	const code = reason.code;
	sendRoomMessage(socket, { type: SessionMessageKind.Reject, code, reason });
	socket.close(1008, 'Change rejected');
	return { kind: RoomFailureKind.Rejected, code, reason };
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
		throw new TerminalSessionFailure(SessionFailureCode.RepeatedCommandRefusal, {
			code: SessionFailureCode.RepeatedCommandRefusal,
		});
	sendRoomMessage(socket, {
		type: SessionMessageKind.Conflict,
		code: ConflictCode.TextTargetGone,
		id: message.id,
		target: message.target,
	});
}
