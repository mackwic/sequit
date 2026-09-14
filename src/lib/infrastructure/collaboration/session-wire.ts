import { decode, encode } from 'cborg';

import type { SharedDocumentCommand } from '../document/shared-document-command';
import { type ParticipantPresence, readParticipantPresence } from './participant-presence';
export type { LocalPresence, ParticipantPresence } from './participant-presence';
import { readSharedCommand } from './shared-command-codec';
import { wireBytes, wireId, wireInteger, wireKeys, wireObject, wireString } from './wire-values';

export const SESSION_WIRE_VERSION = 3;
export const SESSION_FRAME_LIMIT = 1024 * 1024;

export enum SessionMessageKind {
	Sync = 'sync',
	Initialize = 'initialize',
	Change = 'change',
	Commit = 'commit',
	Reject = 'reject',
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

interface CommandMessage {
	readonly type: SessionMessageKind.Change;
	readonly id: string;
	readonly commands: readonly SharedDocumentCommand[];
}

interface TextMessage {
	readonly type: SessionMessageKind.Change;
	readonly update: Uint8Array;
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
	| PresenceMessage;

function readChange(message: Record<string, unknown>): CommandMessage | TextMessage {
	if ('update' in message) {
		wireKeys(message, ['type', 'update']);
		return { type: SessionMessageKind.Change, update: wireBytes(message['update']) };
	}
	wireKeys(message, ['type', 'id', 'commands']);
	const commands: unknown = message['commands'];
	if (!Array.isArray(commands)) throw new Error('Expected commands array');
	if (commands.length === 0 || commands.length > 100) throw new Error('Expected 1 to 100 commands');
	return {
		type: SessionMessageKind.Change,
		id: wireId(message['id']),
		commands: commands.map((command: unknown) => readSharedCommand(command)),
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
			wireKeys(message, ['type', 'message']);
			return { type: SessionMessageKind.Reject, message: wireString(message['message']) };
		case SessionMessageKind.Presence:
			wireKeys(message, ['type', 'participants']);
			if (!Array.isArray(message['participants'])) throw new Error('Expected presence list');
			return {
				type: SessionMessageKind.Presence,
				participants: message['participants'].map((value: unknown) =>
					readParticipantPresence(value),
				),
			};
		default:
			throw new Error('Unknown session message');
	}
}

export function encodeSessionMessage(message: SessionMessage): Uint8Array {
	const frame = encode([SESSION_WIRE_VERSION, readMessage(message)]);
	if (frame.byteLength > SESSION_FRAME_LIMIT) throw new Error('Session frame too large');
	return frame;
}

export function decodeSessionMessage(frame: Uint8Array): SessionMessage {
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
	if (envelope[0] !== SESSION_WIRE_VERSION) throw new Error('Unsupported session version');
	return readMessage(envelope[1]);
}
