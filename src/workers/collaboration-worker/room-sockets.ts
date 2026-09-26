import { SessionFailureCode } from '../../lib/infrastructure/collaboration/session-failure';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	LEGACY_SESSION_WIRE_VERSION,
	type ParticipantPresence,
	type SessionMessage,
	SessionMessageKind,
} from '../../lib/infrastructure/collaboration/session-wire';

interface SocketAttachment {
	readonly version: 4 | 5;
	readonly presence?: Uint8Array;
}

function socketAttachment(socket: WebSocket): SocketAttachment {
	const stored: unknown = socket.deserializeAttachment();
	if (stored instanceof Uint8Array) return { version: 4, presence: stored };
	if (typeof stored !== 'object') return { version: LEGACY_SESSION_WIRE_VERSION };
	if (stored === null) return { version: LEGACY_SESSION_WIRE_VERSION };
	if (!('version' in stored)) return { version: LEGACY_SESSION_WIRE_VERSION };
	const version = stored.version;
	if (version !== 4 && version !== 5) return { version: LEGACY_SESSION_WIRE_VERSION };
	let presence: Uint8Array | undefined;
	if ('presence' in stored) {
		if (stored.presence instanceof Uint8Array) presence = stored.presence;
	}
	if (presence !== undefined) return { version, presence };
	return { version };
}

export function rememberSocketVersion(socket: WebSocket, version: 4 | 5): void {
	const attachment = socketAttachment(socket);
	if (attachment.version !== version) socket.serializeAttachment({ ...attachment, version });
}

export function storeSocketPresence(socket: WebSocket, message: SessionMessage): void {
	socket.serializeAttachment({
		version: socketAttachment(socket).version,
		presence: encodeSessionMessage(message),
	});
}

export function sendRoomMessage(socket: WebSocket, message: SessionMessage): void {
	try {
		const version = socketAttachment(socket).version;
		if (message.type === SessionMessageKind.Conflict && version === LEGACY_SESSION_WIRE_VERSION) {
			socket.send(
				encodeSessionMessage(
					{
						type: SessionMessageKind.Reject,
						code: SessionFailureCode.InvalidDocument,
						message: message.message,
					},
					version,
				),
			);
			socket.close(1008, 'Change rejected');
			return;
		}
		socket.send(encodeSessionMessage(message, version));
	} catch {
		// A departed participant must not interrupt delivery to the room.
	}
}

export function roomPresence(sockets: readonly WebSocket[], excluded?: WebSocket): SessionMessage {
	const participants: ParticipantPresence[] = [];
	for (const peer of sockets) {
		if (peer === excluded) continue;
		try {
			const attachment = socketAttachment(peer);
			if (attachment.presence === undefined) continue;
			const message = decodeSessionMessage(attachment.presence);
			if (message.type === SessionMessageKind.Presence) participants.push(...message.participants);
		} catch {
			// Ephemeral presence from obsolete protocol versions is discarded.
		}
	}
	return { type: SessionMessageKind.Presence, participants };
}

export function broadcastRoomPresence(sockets: readonly WebSocket[], excluded?: WebSocket): void {
	const message = roomPresence(sockets, excluded);
	let legacy: Uint8Array | undefined;
	let modern: Uint8Array | undefined;
	for (const peer of sockets) {
		if (peer === excluded) continue;
		try {
			const version = socketAttachment(peer).version;
			if (version === LEGACY_SESSION_WIRE_VERSION) {
				legacy ??= encodeSessionMessage(message, LEGACY_SESSION_WIRE_VERSION);
				peer.send(legacy);
			} else {
				modern ??= encodeSessionMessage(message);
				peer.send(modern);
			}
		} catch {
			// A departed participant cannot prevent presence reaching the others.
		}
	}
}
