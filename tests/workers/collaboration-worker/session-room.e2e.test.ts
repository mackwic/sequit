import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import {
	CollaborationStatus,
	createCollaborativeDocumentSession,
} from '../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import {
	type CollaborationWebSocket,
	type CollaborationWebSocketFactory,
	createWebSocketCollaborationTransport,
} from '../../../src/lib/infrastructure/collaboration/websocket-collaboration-transport';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../src/lib/infrastructure/document/shared-document-command';
import worker from '../../../src/workers/collaboration-worker/index';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../support/fixtures/collaborative-document';

type SocketListener = Parameters<CollaborationWebSocket['addEventListener']>[1];

class WorkerdWebSocket implements CollaborationWebSocket {
	binaryType = 'arraybuffer';
	readonly #listeners = new Map<string, Set<SocketListener>>();
	#socket: WebSocket | undefined;
	#closed = false;

	constructor(url: string) {
		void this.connect(url);
	}

	get readyState(): number {
		return this.#socket?.readyState ?? 0;
	}

	send(data: Uint8Array): void {
		this.#socket?.send(data);
	}

	close(code = 1000): void {
		this.#closed = true;
		this.#socket?.close(code, 'Transport closed');
	}

	addEventListener(type: string, listener: SocketListener): void {
		const listeners = this.#listeners.get(type) ?? new Set<SocketListener>();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: SocketListener): void {
		this.#listeners.get(type)?.delete(listener);
	}

	async connect(url: string): Promise<void> {
		const requestUrl = new URL(url);
		if (requestUrl.protocol === 'wss:') requestUrl.protocol = 'https:';
		else requestUrl.protocol = 'http:';
		const response = await worker.fetch(
			new Request(requestUrl, { headers: { upgrade: 'websocket' } }),
			env,
		);
		const socket = response.webSocket;
		if (socket === null) throw new Error('Expected upgraded socket');
		if (this.#closed) {
			socket.accept();
			socket.close(1000, 'Transport closed before connection');
			return;
		}
		this.#socket = socket;
		socket.binaryType = 'arraybuffer';
		socket.addEventListener('message', (event) => {
			this.dispatch('message', event);
		});
		socket.addEventListener('close', (event) => {
			this.dispatch('close', event);
		});
		socket.accept();
	}

	private dispatch(type: string, event: Event): void {
		for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
	}
}

const workerdWebSocketFactory: CollaborationWebSocketFactory = (url) => new WorkerdWebSocket(url);

describe('real sessions through the Durable Object', () => {
	it('initializes, edits text continuously and dispatches a structural command', async () => {
		const room = 'real-sessions';
		const initial = collaborativeFixture(CollaborativeFixture.TwoBoxes, room);
		const alice = createCollaborativeDocumentSession(
			initial,
			createWebSocketCollaborationTransport(room, 'https://sequit.local', workerdWebSocketFactory),
		);
		const bob = createCollaborativeDocumentSession(
			initial,
			createWebSocketCollaborationTransport(room, 'https://sequit.local', workerdWebSocketFactory),
		);
		try {
			await vi.waitFor(() => {
				expect(alice.connectionStatus()).toBe(CollaborationStatus.Ready);
				expect(bob.connectionStatus()).toBe(CollaborationStatus.Ready);
			});
			alice.replaceNodeMarkdown('A', 'Alpha modifié');
			await vi.waitFor(() => {
				expect(bob.read().nodes[0]?.markdown).toBe('Alpha modifié');
			});
			const rejected = vi.fn();
			alice.subscribeToRejection(rejected);
			alice.replaceNodeMarkdown('B', 'Dernière frappe avant suppression');
			alice.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
			await vi.waitFor(() => {
				expect(bob.read().nodes.map((node) => node.id)).toEqual(['A']);
			});
			alice.replaceNodeMarkdown('A', 'La session continue');
			await vi.waitFor(() => {
				expect(bob.read().nodes[0]?.markdown).toBe('La session continue');
			});
			expect(rejected).not.toHaveBeenCalled();
		} finally {
			alice.destroy();
			bob.destroy();
		}
	});

	it('closes the rejected session and notifies its refresh callback', async () => {
		const room = 'real-rejection';
		const client = createCollaborativeDocumentSession(
			collaborativeFixture(CollaborativeFixture.LinkedBoxes, room),
			createWebSocketCollaborationTransport(room, 'https://sequit.local', workerdWebSocketFactory),
		);
		try {
			await vi.waitFor(() => {
				expect(client.connectionStatus()).toBe(CollaborationStatus.Ready);
			});
			const refresh = vi.fn();
			client.subscribeToRejection(refresh);
			client.dispatch([
				{
					op: Op.Create,
					target: { kind: Kind.Relation, id: 'cycle' },
					properties: { from: 'A', to: 'B' },
				},
			]);
			await vi.waitFor(() => {
				expect(refresh).toHaveBeenCalledOnce();
			});
			expect(client.connectionStatus()).toBe(CollaborationStatus.Disconnected);
			expect(client.read().relations).toHaveLength(1);
		} finally {
			client.destroy();
		}
	});
});
