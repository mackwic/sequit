import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import {
	CollaborationStatus,
	createCollaborativeDocumentSession,
} from '../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import { ConflictCode } from '../../../src/lib/infrastructure/collaboration/session-failure';
import {
	decodeSessionMessage,
	SessionMessageKind as Message,
} from '../../../src/lib/infrastructure/collaboration/session-wire';
import {
	type CollaborationWebSocket,
	type CollaborationWebSocketFactory,
	createWebSocketCollaborationTransport,
} from '../../../src/lib/infrastructure/collaboration/websocket-collaboration-transport';
import { DocumentCommandOutcomeKind } from '../../../src/lib/infrastructure/document/document-command-contracts';
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
	readonly held: Uint8Array[] = [];
	hold: ((data: Uint8Array) => boolean) | undefined;
	release(): void {
		for (const frame of this.held.splice(0)) this.#socket?.send(frame);
	}

	constructor(url: string) {
		void this.connect(url);
	}

	get readyState(): number {
		return this.#socket?.readyState ?? 0;
	}

	send(data: Uint8Array | string): void {
		if (data instanceof Uint8Array && this.hold !== undefined) {
			if (this.hold(data)) {
				this.held.push(data);
				return;
			}
		}
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
			alice.updateText({ kind: Kind.Node, id: 'A' }, 'markdown', 'Alpha modifié');
			await vi.waitFor(() => {
				expect(bob.read().nodes[0]?.markdown).toBe('Alpha modifié');
			});
			const rejected = vi.fn();
			alice.subscribeToRejection(rejected);
			alice.updateText(
				{ kind: Kind.Node, id: 'B' },
				'markdown',
				'Dernière frappe avant suppression',
			);
			const deletion = alice.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
			await vi.waitFor(() => {
				expect(bob.read().nodes.map((node) => node.id)).toEqual(['A']);
			});
			const accepted = await deletion;
			if (accepted.kind !== DocumentCommandOutcomeKind.Accepted)
				throw new Error('Expected accepted');
			expect(accepted.document.nodes.map((node) => node.id)).toEqual(['A']);
			alice.updateText({ kind: Kind.Node, id: 'A' }, 'markdown', 'La session continue');
			await vi.waitFor(() => {
				expect(bob.read().nodes[0]?.markdown).toBe('La session continue');
			});
			expect(rejected).not.toHaveBeenCalled();
		} finally {
			alice.destroy();
			bob.destroy();
		}
	});

	it('refuses Alice’s unacknowledged deleted-box text, drops the other box edit and remounts her replica', async () => {
		const room = 'real-text-race';
		const initial = collaborativeFixture(CollaborativeFixture.TwoBoxes, room);
		let socket: WorkerdWebSocket | undefined;
		const alice = createCollaborativeDocumentSession(
			initial,
			createWebSocketCollaborationTransport(room, 'https://sequit.local', (url) => {
				socket = new WorkerdWebSocket(url);
				return socket;
			}),
		);
		const bob = createCollaborativeDocumentSession(
			initial,
			createWebSocketCollaborationTransport(room, 'https://sequit.local', workerdWebSocketFactory),
		);
		const notice = vi.fn();
		alice.subscribeToConflict(notice);
		const replica = alice.document;
		const rejected = vi.fn();
		alice.subscribeToRejection(rejected);
		try {
			await vi.waitFor(() => {
				expect(alice.connectionStatus()).toBe(CollaborationStatus.Ready);
				expect(bob.connectionStatus()).toBe(CollaborationStatus.Ready);
			});
			if (socket === undefined) throw new Error('Expected Alice socket');
			socket.hold = (frame) => {
				const message = decodeSessionMessage(frame);
				return message.type === Message.Change && 'update' in message;
			};
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			alice.updateText({ kind: Kind.Node, id: 'B' }, 'markdown', 'Brouillon perdu');
			alice.updateText({ kind: Kind.Node, id: 'A' }, 'markdown', 'Saisie abandonnée');
			const deleted = new Promise<void>((resolve) => {
				const stop = bob.subscribe((document) => {
					if (document.nodes.some(({ id }) => id === 'B')) return;
					stop();
					resolve();
				});
			});
			void bob.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
			await deleted;
			expect(socket.held).toHaveLength(1); // Switching boxes flushed B before deletion.
			vi.advanceTimersByTime(50);
			vi.useRealTimers();
			await vi.waitFor(() => {
				expect(socket?.held).toHaveLength(1);
			});
			socket.hold = undefined;
			socket.release();
			await vi.waitFor(
				() => {
					expect(notice).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('B, A'));
				},
				{ timeout: 1000 },
			);
			await vi.waitFor(() => {
				expect(rejected.mock.calls).toEqual([]);
				expect(alice.connectionStatus()).toBe(CollaborationStatus.Ready);
				expect(bob.read().nodes[0]?.markdown).toBe('Alpha');
			});
			expect(alice.document).not.toBe(replica);
			expect(alice.replica()).toBe(1);
			expect(alice.read().nodes.map(({ id }) => id)).toEqual(['A']);
			alice.updateText({ kind: Kind.Node, id: 'A' }, 'markdown', 'Encore modifiable');
			await vi.waitFor(() => {
				expect(bob.read().nodes[0]?.markdown).toBe('Encore modifiable');
			});
		} finally {
			vi.useRealTimers();
			alice.destroy();
			bob.destroy();
		}
	});

	it('drops unsent text for both boxes after reconnect when Bob deleted its target offline', async () => {
		const room = 'real-offline-text-race';
		const initial = collaborativeFixture(CollaborativeFixture.TwoBoxes, room);
		let socket: WorkerdWebSocket | undefined;
		const alice = createCollaborativeDocumentSession(
			initial,
			createWebSocketCollaborationTransport(room, 'https://sequit.local', (url) => {
				socket = new WorkerdWebSocket(url);
				return socket;
			}),
		);
		const bob = createCollaborativeDocumentSession(
			initial,
			createWebSocketCollaborationTransport(room, 'https://sequit.local', workerdWebSocketFactory),
		);
		const notice = vi.fn();
		alice.subscribeToConflict(notice);
		try {
			await vi.waitFor(() => {
				expect(alice.connectionStatus()).toBe(CollaborationStatus.Ready);
				expect(bob.connectionStatus()).toBe(CollaborationStatus.Ready);
			});
			const old = socket;
			if (old === undefined) throw new Error('Expected Alice socket');
			old.hold = (frame) => {
				const message = decodeSessionMessage(frame);
				return message.type === Message.Change && 'update' in message;
			};
			alice.updateText({ kind: Kind.Node, id: 'B' }, 'markdown', 'Brouillon hors ligne');
			alice.updateText({ kind: Kind.Node, id: 'A' }, 'markdown', 'Autre brouillon hors ligne');
			expect(old.held).toHaveLength(1);
			old.close();
			await vi.waitFor(() => {
				expect(alice.connectionStatus()).toBe(CollaborationStatus.Disconnected);
			});
			void bob.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
			await vi.waitFor(() => {
				expect(bob.read().nodes.map(({ id }) => id)).toEqual(['A']);
			});
			await vi.waitFor(
				() => {
					expect(socket).not.toBe(old);
					expect(notice).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('B, A'));
					expect(alice.connectionStatus()).toBe(CollaborationStatus.Ready);
				},
				{ timeout: 4_000 },
			);
			expect(alice.replica()).toBe(1);
			expect(bob.read().nodes[0]?.markdown).toBe('Alpha');
			expect(alice.read().nodes[0]?.markdown).toBe('Alpha');
			alice.updateText({ kind: Kind.Node, id: 'A' }, 'markdown', 'Après reconnexion');
			await vi.waitFor(() => {
				expect(bob.read().nodes[0]?.markdown).toBe('Après reconnexion');
			});
		} finally {
			alice.destroy();
			bob.destroy();
		}
	}, 10_000);

	it('refuses a delayed grouping after Bob moves A and accepts Alice’s next command', async () => {
		const room = 'real-command-race';
		const initial = collaborativeFixture(CollaborativeFixture.TwoBoxes, room);
		let socket: WorkerdWebSocket | undefined;
		const alice = createCollaborativeDocumentSession(
			initial,
			createWebSocketCollaborationTransport(room, 'https://sequit.local', (url) => {
				socket = new WorkerdWebSocket(url);
				return socket;
			}),
		);
		const bob = createCollaborativeDocumentSession(
			initial,
			createWebSocketCollaborationTransport(room, 'https://sequit.local', workerdWebSocketFactory),
		);
		const decisions = vi.fn();
		alice.subscribeToDecisions(decisions);
		try {
			await vi.waitFor(() => {
				expect(alice.connectionStatus()).toBe(CollaborationStatus.Ready);
				expect(bob.connectionStatus()).toBe(CollaborationStatus.Ready);
			});
			if (socket === undefined) throw new Error('Expected Alice socket');
			socket.hold = (frame) => {
				const message = decodeSessionMessage(frame);
				return message.type === Message.Change && 'commands' in message;
			};
			const refused = alice.dispatch([
				{ op: Op.Group, id: 'stale', label: 'Stale', members: ['A', 'B'] },
			]);
			await vi.waitFor(() => {
				expect(socket?.held).toHaveLength(1);
			});
			void bob.dispatch([{ op: Op.Group, id: 'moved', label: 'Moved', members: ['A'] }]);
			await vi.waitFor(() => {
				expect(bob.read().groups.map(({ id }) => id)).toContain('moved');
			});
			socket.hold = undefined;
			socket.release();
			await expect(refused).resolves.toEqual({
				kind: DocumentCommandOutcomeKind.Rejected,
				diagnostics: [expect.objectContaining({ code: ConflictCode.CommandConflict, path: [] })],
			});
			expect(decisions).toHaveBeenCalledWith(expect.objectContaining({ type: 'refused' }));
			await vi.waitFor(() => {
				expect(alice.connectionStatus()).toBe(CollaborationStatus.Ready);
			});
			const accepted = await alice.dispatch([
				{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } },
			]);
			if (accepted.kind !== DocumentCommandOutcomeKind.Accepted)
				throw new Error('Expected accepted');
			expect(accepted.document.nodes.map(({ id }) => id)).toEqual(['A']);
			expect(decisions).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'accepted' }));
			await vi.waitFor(() => {
				expect(bob.read().nodes.map(({ id }) => id)).toEqual(['A']);
			});
		} finally {
			alice.destroy();
			bob.destroy();
		}
	});

	it('keeps a business rejection nonterminal and permits a later command', async () => {
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
			const decisions = vi.fn();
			client.subscribeToRejection(refresh);
			client.subscribeToDecisions(decisions);
			const refused = client.dispatch([
				{
					op: Op.Create,
					target: { kind: Kind.Relation, id: 'cycle' },
					properties: { from: 'A', to: 'B' },
				},
			]);
			await expect(refused).resolves.toEqual({
				kind: DocumentCommandOutcomeKind.Rejected,
				diagnostics: [expect.objectContaining({ code: ConflictCode.InvalidCommand, path: [] })],
			});
			expect(decisions).toHaveBeenCalledWith(expect.objectContaining({ type: 'refused' }));
			await vi.waitFor(() => {
				expect(client.connectionStatus()).toBe(CollaborationStatus.Ready);
			});
			expect(refresh).not.toHaveBeenCalled();
			expect(client.read().relations).toHaveLength(1);
		} finally {
			client.destroy();
		}
	});
});
