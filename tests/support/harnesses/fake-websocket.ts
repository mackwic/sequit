import type {
	CollaborationWebSocket,
	CollaborationWebSocketFactory,
} from '../../../src/lib/infrastructure/collaboration/websocket-collaboration-transport';

type Listener = Parameters<CollaborationWebSocket['addEventListener']>[1];

export class FakeWebSocket implements CollaborationWebSocket {
	binaryType = '';
	readyState = 1;
	readonly sent: Uint8Array[] = [];
	readonly closeCodes: number[] = [];
	readonly listeners = new Map<string, Set<Listener>>();

	send(data: Uint8Array): void {
		this.sent.push(data);
	}
	close(code?: number): void {
		if (code !== undefined) this.closeCodes.push(code);
		this.readyState = 3;
	}
	addEventListener(type: string, listener: Listener): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: Listener): void {
		this.listeners.get(type)?.delete(listener);
	}
	emitMessage(data: unknown): void {
		this.emit('message', { data });
	}
	emitClose(): void {
		this.readyState = 3;
		this.emit('close', { code: 1006 });
	}
	private emit(type: string, event: { readonly data: unknown } | { readonly code: number }): void {
		for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
	}
}

export interface FakeWebSocketFactory {
	readonly factory: CollaborationWebSocketFactory;
	readonly sockets: readonly FakeWebSocket[];
}

export function createFakeWebSocketFactory(): FakeWebSocketFactory {
	const sockets: FakeWebSocket[] = [];
	return {
		factory: () => {
			const socket = new FakeWebSocket();
			sockets.push(socket);
			return socket;
		},
		sockets,
	};
}
