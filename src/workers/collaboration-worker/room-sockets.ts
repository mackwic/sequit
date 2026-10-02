import {
	decodeSessionMessage,
	encodeSessionMessage,
	LEGACY_SESSION_WIRE_VERSION,
	type ParticipantPresence,
	type SessionMessage,
	SessionMessageKind,
} from '../../lib/infrastructure/collaboration/session-wire';

interface SocketAttachment {
	readonly version: 5 | 6;
	readonly presence?: Uint8Array;
}

function isSocketAttachment(value: unknown): value is SocketAttachment {
	if (typeof value !== 'object') return false;
	if (value === null) return false;
	if (!('version' in value)) return false;
	if (value.version === 5) return true;
	return value.version === 6;
}

function socketAttachment(socket: WebSocket): SocketAttachment {
	const stored: unknown = socket.deserializeAttachment();
	if (stored instanceof Uint8Array) return { version: LEGACY_SESSION_WIRE_VERSION };
	if (isSocketAttachment(stored)) return stored;
	return { version: LEGACY_SESSION_WIRE_VERSION };
}

export function rememberSocketVersion(socket: WebSocket, version: 5 | 6): void {
	const attachment = socketAttachment(socket);
	if (attachment.version !== version) socket.serializeAttachment({ ...attachment, version });
}

export function storeSocketPresence(
	socket: WebSocket,
	message: Extract<SessionMessage, { type: SessionMessageKind.Presence }>,
): void {
	socket.serializeAttachment({
		...socketAttachment(socket),
		presence: encodeSessionMessage(message),
	});
}

export function sendRoomMessage(socket: WebSocket, message: SessionMessage): void {
	try {
		const version = socketAttachment(socket).version;
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
			if (message.type !== SessionMessageKind.Presence) continue;
			participants.push(...message.participants);
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
