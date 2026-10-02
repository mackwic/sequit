import {
	type CommandRefusal,
	CommandRefusalCode,
	ConflictCode,
	SessionFailureCode,
	type SessionRejection,
} from './session-reasons';
import {
	type LegacySessionMessage,
	type SessionMessage,
	SessionMessageKind,
} from './session-wire-types';
import { readSharedTarget } from './shared-command-codec';
import { wireId, wireInteger, wireKeys, wireObject, wireString } from './wire-values';

function readLegacyConflict(message: Record<string, unknown>): LegacySessionMessage {
	const code = Object.values(ConflictCode).find((value) => value === message['code']);
	if (code === undefined) throw new Error('Unknown conflict code');
	if (code === ConflictCode.TextTargetGone) {
		wireKeys(message, ['type', 'code', 'message', 'id', 'target']);
		return {
			type: SessionMessageKind.Conflict,
			code,
			message: wireString(message['message']),
			id: wireId(message['id']),
			target: readSharedTarget(message['target']),
		};
	}
	wireKeys(message, ['type', 'code', 'message', 'id', 'lastAcceptedSequence']);
	return {
		type: SessionMessageKind.Conflict,
		code,
		message: wireString(message['message']),
		id: wireId(message['id']),
		lastAcceptedSequence: wireInteger(message['lastAcceptedSequence']),
	};
}

export function readLegacyMessage(
	value: unknown,
	readCurrentMessage: (value: unknown) => SessionMessage,
): LegacySessionMessage {
	const message = wireObject(value);
	switch (message['type']) {
		case SessionMessageKind.Reject: {
			wireKeys(message, ['type', 'message', 'code']);
			const legacyMessage = wireString(message['message']);
			if (message['code'] === undefined)
				return { type: SessionMessageKind.Reject, message: legacyMessage };
			const code = Object.values(SessionFailureCode).find(
				(candidate) => candidate === message['code'],
			);
			if (code === undefined) throw new Error('Unknown session failure code');
			return { type: SessionMessageKind.Reject, code, message: legacyMessage };
		}
		case SessionMessageKind.Retry: {
			wireKeys(message, ['type', 'message', 'code']);
			const code = Object.values(SessionFailureCode).find(
				(candidate) => candidate === message['code'],
			);
			if (code === undefined) throw new Error('Unknown session failure code');
			return {
				type: SessionMessageKind.Retry,
				code,
				message: wireString(message['message']),
			};
		}
		case SessionMessageKind.Conflict:
			return readLegacyConflict(message);
		default: {
			const currentMessage = readCurrentMessage(message);
			switch (currentMessage.type) {
				case SessionMessageKind.Initialize:
				case SessionMessageKind.Sync:
				case SessionMessageKind.Change:
				case SessionMessageKind.Commit:
				case SessionMessageKind.Presence:
					return currentMessage;
				case SessionMessageKind.Reject:
				case SessionMessageKind.Retry:
				case SessionMessageKind.Conflict:
				default:
					throw new Error('Unexpected legacy session message');
			}
		}
	}
}

/** Technical details serialized by `legacyReasonMessage`, if the text has that shape. */
function neutralDetails(text: string): readonly string[] | undefined {
	let details: unknown;
	try {
		details = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!Array.isArray(details)) return undefined;
	const strings = details.filter((detail: unknown): detail is string => typeof detail === 'string');
	if (strings.length !== details.length) return undefined;
	return strings;
}

// Decode the neutral form emitted below; keep old v5 text opaque as a technical detail.
function legacyDetails(code: string, message: string): readonly string[] {
	if (message === code) return [];
	const neutralPrefix = `${code}: `;
	if (!message.startsWith(neutralPrefix)) return [message];
	return neutralDetails(message.slice(neutralPrefix.length)) ?? [message];
}

/** A v5 receipt rejection names its session, in the neutral form or in the old French sentence. */
function legacyReceiptSession(message: string): string {
	const neutralPrefix = `${SessionFailureCode.CorruptCommandReceipt}:`;
	if (message.startsWith(neutralPrefix)) return wireId(message.slice(neutralPrefix.length));
	const sessionId = /^Reçu de commande corrompu pour la session (.+)\.$/u.exec(message)?.[1];
	if (sessionId === undefined) throw new Error('Missing legacy command receipt session ID');
	return wireId(sessionId);
}

function legacyRejection(code: SessionFailureCode | undefined, message: string): SessionRejection {
	if (code === undefined) return { code: SessionFailureCode.InvalidMessage, details: [message] };
	switch (code) {
		case SessionFailureCode.InvalidMessage:
		case SessionFailureCode.InvalidDocument:
			return { code, details: legacyDetails(code, message) };
		case SessionFailureCode.StorageUnavailable:
		case SessionFailureCode.CommandGap:
		case SessionFailureCode.RepeatedCommandRefusal:
			return { code };
		case SessionFailureCode.CorruptCommandReceipt:
			return { code, sessionId: legacyReceiptSession(message) };
		default: {
			const unhandled: never = code;
			throw new Error(`Unknown session failure code: ${String(unhandled)}`);
		}
	}
}

export function toCurrentMessage(message: LegacySessionMessage): SessionMessage {
	switch (message.type) {
		case SessionMessageKind.Reject:
			return {
				type: message.type,
				code: message.code ?? SessionFailureCode.InvalidMessage,
				reason: legacyRejection(message.code, message.message),
			};
		case SessionMessageKind.Retry:
			return {
				type: message.type,
				code: message.code,
				reason: legacyRejection(message.code, message.message),
			};
		case SessionMessageKind.Conflict:
			if (message.code === ConflictCode.TextTargetGone)
				return {
					type: message.type,
					code: message.code,
					id: message.id,
					target: message.target,
				};
			return {
				type: message.type,
				code: message.code,
				reason: {
					code: CommandRefusalCode.InvalidDocument,
					details: [message.message],
				},
				id: message.id,
				lastAcceptedSequence: message.lastAcceptedSequence,
			};
		case SessionMessageKind.Sync:
		case SessionMessageKind.Initialize:
		case SessionMessageKind.Change:
		case SessionMessageKind.Commit:
		case SessionMessageKind.Presence:
			return message;
		default: {
			const unhandled: never = message;
			throw new Error(`Unknown legacy session message: ${String(unhandled)}`);
		}
	}
}

// v5 requires message strings; emit only neutral codes and optional technical details.
function legacyReasonMessage(reason: CommandRefusal | SessionRejection): string {
	if (reason.code === SessionFailureCode.CorruptCommandReceipt)
		return `${reason.code}:${reason.sessionId}`;
	if ('details' in reason && reason.details.length > 0)
		return `${reason.code}: ${JSON.stringify(reason.details)}`;
	return reason.code;
}

export function toLegacyMessage(message: SessionMessage): LegacySessionMessage {
	switch (message.type) {
		case SessionMessageKind.Reject:
		case SessionMessageKind.Retry:
			return {
				type: message.type,
				code: message.code,
				message: legacyReasonMessage(message.reason),
			};
		case SessionMessageKind.Conflict:
			if (message.code === ConflictCode.TextTargetGone)
				return {
					type: message.type,
					code: message.code,
					message: message.code,
					id: message.id,
					target: message.target,
				};
			return {
				type: message.type,
				code: message.code,
				message: legacyReasonMessage(message.reason),
				id: message.id,
				lastAcceptedSequence: message.lastAcceptedSequence,
			};
		case SessionMessageKind.Sync:
		case SessionMessageKind.Initialize:
		case SessionMessageKind.Change:
		case SessionMessageKind.Commit:
		case SessionMessageKind.Presence:
			return message;
		default: {
			const unhandled: never = message;
			throw new Error(`Unknown session message: ${String(unhandled)}`);
		}
	}
}
