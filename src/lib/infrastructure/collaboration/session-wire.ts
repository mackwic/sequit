import { decode, encode } from 'cborg';

import type { SharedDocumentCommand, SharedTarget } from '../document/shared-document-command';
import { type CommandSequence, readCommandSequence } from './command-sequence';
import {
	InvalidPresenceError,
	MAX_PRESENCE_PARTICIPANTS,
	type ParticipantPresence,
	readParticipantPresence,
} from './participant-presence';
import { ConflictCode, SessionFailureCode } from './session-failure';
export type { SharedTarget } from '../document/shared-document-command';
export type { LocalPresence, ParticipantPresence } from './participant-presence';
import { readSharedCommand, readSharedTarget } from './shared-command-codec';
import { wireBytes, wireId, wireInteger, wireKeys, wireObject, wireString } from './wire-values';

export const SESSION_WIRE_VERSION = 5;
export const LEGACY_SESSION_WIRE_VERSION = 4;
export const SESSION_FRAME_LIMIT = 1024 * 1024;

export enum SessionMessageKind {
	Sync = 'sync',
	Initialize = 'initialize',
	Change = 'change',
	Commit = 'commit',
	Reject = 'reject',
	Retry = 'retry',
	Conflict = 'conflict',
	Presence = 'presence',
}

interface InitializeMessage {
	readonly type: SessionMessageKind.Initialize;
	readonly id: string;
	readonly update: Uint8Array;
}

interface SyncMessage {
	readonly type: SessionMessageKind.Sync;
	readonly payload: Uint8Array;
}

interface CommandMessage extends CommandSequence {
	readonly type: SessionMessageKind.Change;
	readonly id: string;
	readonly commands: readonly SharedDocumentCommand[];
}

interface TextMessage {
	readonly type: SessionMessageKind.Change;
	readonly update: Uint8Array;
	readonly id?: string;
	readonly targets?: readonly SharedTarget[];
}

interface CommitMessage {
	readonly type: SessionMessageKind.Commit;
	readonly update: Uint8Array;
	readonly commit: number;
	readonly id?: string;
}

interface RejectMessage {
	readonly type: SessionMessageKind.Reject;
	readonly message: string;
	readonly code?: SessionFailureCode;
}

interface RetryMessage {
	readonly type: SessionMessageKind.Retry;
	readonly message: string;
	readonly code: SessionFailureCode;
}

interface LegacyTextMessage {
	readonly type: SessionMessageKind.Change;
	readonly update: Uint8Array;
}

interface ConflictMessage {
	readonly type: SessionMessageKind.Conflict;
	readonly code: ConflictCode;
	readonly message: string;
	readonly id?: string;
	readonly targetId?: string;
	readonly lastAcceptedSequence?: number;
}

interface PresenceMessage {
	readonly type: SessionMessageKind.Presence;
	readonly participants: readonly ParticipantPresence[];
}

export type SessionMessage =
	| InitializeMessage
	| SyncMessage
	| CommandMessage
	| TextMessage
	| CommitMessage
	| RejectMessage
	| RetryMessage
	| ConflictMessage
	| PresenceMessage;

function readTextTargets(value: unknown): readonly SharedTarget[] {
	if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid text targets');
	return value.map(readSharedTarget);
}

function readChange(message: Record<string, unknown>): CommandMessage | TextMessage {
	if ('update' in message) {
		wireKeys(message, ['type', 'update', 'id', 'targets']);
		const result: {
			type: SessionMessageKind.Change;
			update: Uint8Array;
			id?: string;
			targets?: readonly SharedTarget[];
		} = {
			type: SessionMessageKind.Change,
			update: wireBytes(message['update']),
		};
		if (message['id'] !== undefined) result.id = wireId(message['id']);
		if (message['targets'] !== undefined) result.targets = readTextTargets(message['targets']);
		return result;
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

function readConflict(message: Record<string, unknown>): ConflictMessage {
	wireKeys(message, ['type', 'code', 'message', 'id', 'targetId', 'lastAcceptedSequence']);
	const code = Object.values(ConflictCode).find((value) => value === message['code']);
	if (code === undefined) throw new Error('Unknown conflict code');
	const result: {
		type: SessionMessageKind.Conflict;
		code: ConflictCode;
		message: string;
		id?: string;
		targetId?: string;
		lastAcceptedSequence?: number;
	} = {
		type: SessionMessageKind.Conflict,
		code,
		message: wireString(message['message']),
	};
	if (message['id'] !== undefined) result.id = wireId(message['id']);
	if (message['targetId'] !== undefined) result.targetId = wireId(message['targetId']);
	if (message['lastAcceptedSequence'] !== undefined)
		result.lastAcceptedSequence = wireInteger(message['lastAcceptedSequence']);
	return result;
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
			wireKeys(message, ['type', 'message', 'code']);
			const result = { type: message['type'], message: wireString(message['message']) };
			if (result.type === SessionMessageKind.Reject && message['code'] === undefined)
				return { ...result, type: SessionMessageKind.Reject };
			const code = Object.values(SessionFailureCode).find((value) => value === message['code']);
			if (code === undefined) throw new Error('Unknown session failure code');
			return { ...result, code };
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
	if (version === LEGACY_SESSION_WIRE_VERSION && message.type === SessionMessageKind.Conflict)
		throw new Error('Legacy clients do not support conflicts');
	const value = readMessage(message);
	let encoded: SessionMessage | LegacyTextMessage = value;
	if (version === LEGACY_SESSION_WIRE_VERSION && value.type === SessionMessageKind.Change) {
		if ('update' in value) encoded = { type: value.type, update: value.update };
	}
	const frame = encode([version, encoded]);
	if (frame.byteLength > SESSION_FRAME_LIMIT) throw new Error('Session frame too large');
	return frame;
}

export function decodeSessionEnvelope(frame: Uint8Array): {
	version: 4 | 5;
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
	const message = readMessage(envelope[1]);
	if (version === LEGACY_SESSION_WIRE_VERSION) {
		if (message.type === SessionMessageKind.Conflict) throw new Error('Unsupported legacy message');
		if (message.type === SessionMessageKind.Change && 'update' in message) {
			if (message.id !== undefined) throw new Error('Unsupported legacy message');
		}
	}
	return { version, message };
}

export function decodeSessionMessage(frame: Uint8Array): SessionMessage {
	return decodeSessionEnvelope(frame).message;
}
