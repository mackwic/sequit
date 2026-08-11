import { type CollaborationTransport, TransportStatus } from './collaboration-transport';

interface SocketMessageEvent {
	readonly data: unknown;
}

interface SocketCloseEvent {
	readonly code: number;
}

type SocketListener = (event: SocketMessageEvent | SocketCloseEvent | Event) => void;

export interface CollaborationWebSocket {
	binaryType: string;
	readonly readyState: number;
	send(data: Uint8Array): void;
	close(code?: number): void;
	addEventListener(type: string, listener: SocketListener): void;
	removeEventListener(type: string, listener: SocketListener): void;
}

export type CollaborationWebSocketFactory = (url: string) => CollaborationWebSocket;

const INITIAL_RECONNECT_DELAY = 1_000;
const MAX_RECONNECT_DELAY = 30_000;
const SOCKET_OPEN = 1;

function collaborationUrl(roomId: string, baseUrl: string): string {
	const url = new URL(`/collab/${encodeURIComponent(roomId)}`, baseUrl);
	if (url.protocol === 'http:') url.protocol = 'ws:';
	if (url.protocol === 'https:') url.protocol = 'wss:';
	return url.href;
}

function defaultWebSocketFactory(url: string): CollaborationWebSocket {
	return new WebSocket(url);
}

function controlType(data: unknown): string | undefined {
	if (typeof data !== 'string') return undefined;
	try {
		const value: unknown = JSON.parse(data);
		if (typeof value !== 'object') return undefined;
		if (value === null) return undefined;
		if (!('type' in value)) return undefined;
		if (typeof value.type !== 'string') return undefined;
		return value.type;
	} catch {
		return undefined;
	}
}

export function createWebSocketCollaborationTransport(
	roomId: string,
	baseUrl: string,
	webSocketFactory: CollaborationWebSocketFactory = defaultWebSocketFactory,
): CollaborationTransport {
	const frameListeners = new Set<(frame: Uint8Array) => void>();
	const statusListeners = new Set<(status: TransportStatus) => void>();
	let currentStatus = TransportStatus.Connecting;
	let socket: CollaborationWebSocket | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let reconnectDelay = INITIAL_RECONNECT_DELAY;
	let closed = false;
	let removeSocketListeners: (() => void) | undefined;

	const publishStatus = (status: TransportStatus): void => {
		if (currentStatus === status) return;
		currentStatus = status;
		for (const listener of [...statusListeners]) listener(status);
	};
	const publishFrame = (frame: Uint8Array): void => {
		for (const listener of [...frameListeners]) listener(frame);
	};

	const connect = (): void => {
		/* istanbul ignore next -- close clears the only timer that can call connect */
		if (closed) return;
		publishStatus(TransportStatus.Connecting);
		const connection = webSocketFactory(collaborationUrl(roomId, baseUrl));
		socket = connection;
		connection.binaryType = 'arraybuffer';
		const onMessage: SocketListener = (event): void => {
			if (socket !== connection) return;
			if (!('data' in event)) return;
			if (event.data instanceof ArrayBuffer) {
				publishFrame(new Uint8Array(event.data));
				return;
			}
			if (controlType(event.data) !== 'ready') return;
			reconnectDelay = INITIAL_RECONNECT_DELAY;
			publishStatus(TransportStatus.Connected);
		};
		const onClose: SocketListener = (): void => {
			removeListeners();
			if (closed || socket !== connection) return;
			socket = undefined;
			removeSocketListeners = undefined;
			publishStatus(TransportStatus.Disconnected);
			scheduleReconnect();
		};
		connection.addEventListener('message', onMessage);
		connection.addEventListener('close', onClose);
		const removeListeners = (): void => {
			connection.removeEventListener('message', onMessage);
			connection.removeEventListener('close', onClose);
		};
		removeSocketListeners = removeListeners;
	};

	const scheduleReconnect = (): void => {
		if (closed || reconnectTimer !== undefined) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = undefined;
			connect();
		}, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
	};

	connect();

	return {
		send(frame): void {
			if (currentStatus !== TransportStatus.Connected) return;
			if (socket?.readyState !== SOCKET_OPEN) return;
			socket.send(frame);
		},
		subscribeToFrames(listener): () => void {
			frameListeners.add(listener);
			return () => frameListeners.delete(listener);
		},
		subscribeToStatus(listener): () => void {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
		status(): TransportStatus {
			return currentStatus;
		},
		close(): void {
			if (closed) return;
			closed = true;
			if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
			frameListeners.clear();
			statusListeners.clear();
			removeSocketListeners?.();
			removeSocketListeners = undefined;
			if (socket !== undefined) socket.close(1000);
			currentStatus = TransportStatus.Disconnected;
		},
	};
}
