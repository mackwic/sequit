import { decode, encode } from 'cborg';

import { readCommandSequence } from './command-sequence';
import {
	InvalidPresenceError,
	MAX_PRESENCE_PARTICIPANTS,
	readParticipantPresence,
} from './participant-presence';
import { readCommandRefusal, readSessionRejection } from './session-reason-codec';
import { ConflictCode, SessionFailureCode } from './session-reasons';
import { readLegacyMessage, toCurrentMessage, toLegacyMessage } from './session-wire-legacy';
import type {
	CommandConflictMessage,
	IdentifiedTextMessage,
	LegacySessionMessage,
	SessionMessage,
	TextTargetReference,
} from './session-wire-types';
import { SessionMessageKind } from './session-wire-types';
import { readSharedCommand, readSharedTarget } from './shared-command-codec';
import { wireBytes, wireId, wireInteger, wireKeys, wireObject, wireString } from './wire-values';

export { SessionMessageKind };
export type { CommandConflictMessage, IdentifiedTextMessage, SessionMessage, TextTargetReference };
export type { LocalPresence, ParticipantPresence } from './participant-presence';

export const SESSION_WIRE_VERSION = 6;
export const LEGACY_SESSION_WIRE_VERSION = 5;
export const SESSION_FRAME_LIMIT = 1024 * 1024;

function readTextTargetReference(message: Record<string, unknown>): TextTargetReference {
	const textId = wireObject(message['textId']);
	wireKeys(textId, ['client', 'clock']);
	return {
		target: readSharedTarget(message['target']),
		field: wireString(message['field']),
		textId: { client: wireInteger(textId['client']), clock: wireInteger(textId['clock']) },
	};
}

function readChange(message: Record<string, unknown>): SessionMessage {
	if ('update' in message) {
		const update = wireBytes(message['update']);
		if (message['id'] === undefined) {
			wireKeys(message, ['type', 'update']);
			return { type: SessionMessageKind.Change, update };
		}
		wireKeys(message, ['type', 'update', 'id', 'sessionId', 'target', 'field', 'textId']);
		return {
			type: SessionMessageKind.Change,
			update,
			id: wireId(message['id']),
			sessionId: wireId(message['sessionId']),
			...readTextTargetReference(message),
		};
	}
	wireKeys(message, ['type', 'id', 'commands', 'sessionId', 'sequence']);
	const commands: unknown = message['commands'];
	if (!Array.isArray(commands)) throw new Error('Expected commands array');
	if (commands.length === 0 || commands.length > 100) throw new Error('Expected 1 to 100 commands');
	return {
		type: SessionMessageKind.Change,
		id: wireId(message['id']),
		...readCommandSequence(message),
		commands: commands.map((command: unknown) => readSharedCommand(command)),
	};
}

function readConflict(message: Record<string, unknown>): SessionMessage {
	const code = Object.values(ConflictCode).find((value) => value === message['code']);
	if (code === undefined) throw new Error('Unknown conflict code');
	if (code === ConflictCode.TextTargetGone) {
		wireKeys(message, ['type', 'code', 'id', 'target']);
		return {
			type: SessionMessageKind.Conflict,
			code,
			id: wireId(message['id']),
			target: readSharedTarget(message['target']),
		};
	}
	wireKeys(message, ['type', 'code', 'reason', 'id', 'lastAcceptedSequence']);
	return {
		type: SessionMessageKind.Conflict,
		code,
		reason: readCommandRefusal(message['reason']),
		id: wireId(message['id']),
		lastAcceptedSequence: wireInteger(message['lastAcceptedSequence']),
	};
}

function readMessage(value: unknown): SessionMessage {
	const message = wireObject(value);
	switch (message['type']) {
		case SessionMessageKind.Initialize:
			wireKeys(message, ['type', 'id', 'update']);
			return {
				type: SessionMessageKind.Initialize,
				id: wireId(message['id']),
				update: wireBytes(message['update']),
			};
		case SessionMessageKind.Sync:
			wireKeys(message, ['type', 'payload']);
			return { type: SessionMessageKind.Sync, payload: wireBytes(message['payload']) };
		case SessionMessageKind.Change:
			return readChange(message);
		case SessionMessageKind.Commit: {
			wireKeys(message, ['type', 'update', 'commit', 'id']);
			const result = {
				type: SessionMessageKind.Commit,
				update: wireBytes(message['update']),
				commit: wireInteger(message['commit']),
			} as const;
			if (message['id'] === undefined) return result;
			return { ...result, id: wireId(message['id']) };
		}
		case SessionMessageKind.Reject:
		case SessionMessageKind.Retry: {
			wireKeys(message, ['type', 'code', 'reason']);
			const code = Object.values(SessionFailureCode).find((value) => value === message['code']);
			if (code === undefined) throw new Error('Unknown session failure code');
			const reason = readSessionRejection(message['reason']);
			if (reason.code !== code) throw new Error('Session failure code does not match reason');
			return { type: message['type'], code, reason };
		}
		case SessionMessageKind.Conflict:
			return readConflict(message);
		case SessionMessageKind.Presence:
			try {
				wireKeys(message, ['type', 'participants']);
				if (!Array.isArray(message['participants'])) throw new Error('Expected presence list');
				return {
					type: SessionMessageKind.Presence,
					participants: message['participants']
						.slice(0, MAX_PRESENCE_PARTICIPANTS)
						.map((value: unknown) => readParticipantPresence(value)),
				};
			} catch {
				throw new InvalidPresenceError('Invalid ephemeral presence');
			}
		default:
			throw new Error('Unknown session message');
	}
}

export function encodeSessionMessage(
	message: SessionMessage,
	version: typeof SESSION_WIRE_VERSION | typeof LEGACY_SESSION_WIRE_VERSION = SESSION_WIRE_VERSION,
): Uint8Array {
	const value = readMessage(message);
	let encoded: SessionMessage | LegacySessionMessage = value;
	if (version === LEGACY_SESSION_WIRE_VERSION) encoded = toLegacyMessage(value);
	const frame = encode([version, encoded]);
	if (frame.byteLength > SESSION_FRAME_LIMIT) throw new Error('Session frame too large');
	return frame;
}

export function decodeSessionEnvelope(frame: Uint8Array): {
	version: 5 | 6;
	message: SessionMessage;
} {
	if (frame.byteLength > SESSION_FRAME_LIMIT) throw new Error('Session frame too large');
	const envelope: unknown = decode(frame, {
		strict: true,
		allowIndefinite: false,
		allowUndefined: false,
		allowNaN: false,
		allowInfinity: false,
		allowBigInt: false,
		rejectDuplicateMapKeys: true,
	});
	if (!Array.isArray(envelope) || envelope.length !== 2)
		throw new Error('Expected versioned session envelope');
	const version: unknown = envelope[0];
	if (version !== SESSION_WIRE_VERSION && version !== LEGACY_SESSION_WIRE_VERSION)
		throw new Error('Unsupported session version');
	if (version === LEGACY_SESSION_WIRE_VERSION)
		return { version, message: toCurrentMessage(readLegacyMessage(envelope[1], readMessage)) };
	return { version, message: readMessage(envelope[1]) };
}

export function decodeSessionMessage(frame: Uint8Array): SessionMessage {
	return decodeSessionEnvelope(frame).message;
}
