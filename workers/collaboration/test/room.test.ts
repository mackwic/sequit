import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
	ProposalIntent,
} from '../../../src/lib/collaboration/protocol';
import {
	CHUNK_BYTES,
	chunkKeys,
	type DocumentMeta,
	META_KEY,
	planPersistence,
	splitChunks,
} from '../../../src/lib/collaboration/room-persistence';
import { replaceNodeMarkdown } from '../../../src/lib/collaboration/yjs-document-repository';
import {
	collaborativeDocument,
	encodeFullUpdate,
	proposeChange,
} from '../../../tests/builders/collaboration';
import worker from '../src/index';
import {
	decodeStoredRoomState,
	parseDocumentMeta,
	persistRoomState,
	restoreRoomState,
} from '../src/room-storage';

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
	const { promise, resolve } = Promise.withResolvers<MessageEvent>();
	socket.addEventListener('message', resolve, { once: true });
	return promise;
}

async function nextFrame(socket: WebSocket): Promise<CollabMessage> {
	const event = await nextMessage(socket);
	if (!(event.data instanceof ArrayBuffer)) throw new TypeError('Expected a binary protocol frame');
	const decoded = decodeCollabMessage(new Uint8Array(event.data));
	if (!decoded.ok) throw new Error('Expected a decodable protocol frame');
	return decoded.value;
}

async function connect(roomName: string): Promise<WebSocket> {
	const room = env.COLLABORATION_ROOMS.getByName(roomName);
	const response = await room.fetch(`https://sequit.local/collab/${roomName}`, {
		headers: { upgrade: 'websocket' },
	});
	const socket = response.webSocket;
	if (!socket) throw new Error('Expected the WebSocket upgrade to return a socket');
	socket.binaryType = 'arraybuffer';
	socket.accept();
	await nextMessage(socket);
	return socket;
}

function send(socket: WebSocket, message: CollabMessage): void {
	socket.send(encodeCollabMessage(message));
}

function syncRequest(stateVector: Uint8Array, lastCommit = 0): CollabMessage {
	return { type: CollabMessageKind.SyncRequest, lastCommit, stateVector };
}

async function seedStorage(
	roomName: string,
	meta: unknown,
	chunks: readonly Uint8Array[],
): Promise<void> {
	const room = env.COLLABORATION_ROOMS.getByName(roomName);
	await runInDurableObject(room, async (_instance, state) => {
		await state.storage.put(META_KEY, meta);
		const keys = chunkKeys(chunks.length);
		for (const [index, chunk] of chunks.entries()) {
			const key = keys[index];
			if (key !== undefined) await state.storage.put(key, chunk);
		}
	});
	try {
		await runInDurableObject(room, (_instance, state) => {
			state.abort('Replace instance after seeding storage');
		});
	} catch {
		// abort intentionally tears down the current object instance.
	}
}

it('accepts a room connection and answers a ping', async () => {
	const room = env.COLLABORATION_ROOMS.getByName('connection-test');
	const response = await room.fetch('https://sequit.local/collab/connection-test', {
		headers: { upgrade: 'websocket' },
	});

	expect(response.status).toBe(101);
	const socket = response.webSocket;
	expect(socket).not.toBeNull();
	if (!socket) throw new Error('Expected the WebSocket upgrade to return a socket');

	const readyMessage = nextMessage(socket);
	socket.accept();
	expect(JSON.parse(String((await readyMessage).data))).toEqual({ type: 'ready' });

	const pongMessage = nextMessage(socket);
	socket.send(JSON.stringify({ type: 'ping' }));
	expect(JSON.parse(String((await pongMessage).data))).toEqual({ type: 'pong' });
	socket.close(1000, 'Test complete');
});

it('serves health, routing, and upgrade errors through the worker handler', async () => {
	const health = await worker.fetch(new Request('https://sequit.local/health'), env);
	expect(health.status).toBe(200);
	expect(await health.json()).toEqual({ status: 'ok' });

	const missing = await worker.fetch(new Request('https://sequit.local/missing'), env);
	expect(missing.status).toBe(404);
	expect(await missing.json()).toEqual({ error: 'Not found' });

	const noUpgrade = await worker.fetch(new Request('https://sequit.local/collab/no-upgrade'), env);
	expect(noUpgrade.status).toBe(426);
	expect(await noUpgrade.json()).toEqual({ error: 'WebSocket upgrade required' });

	const malformed = await worker.fetch(
		new Request('https://sequit.local/collab/%ZZ', { headers: { upgrade: 'websocket' } }),
		env,
	);
	expect(malformed.status).toBe(400);
	expect(await malformed.json()).toEqual({ error: 'Malformed room id' });

	const response = await worker.fetch(
		new Request('https://sequit.local/collab/routed', { headers: { upgrade: 'websocket' } }),
		env,
	);
	expect(response.status).toBe(101);
	const socket = response.webSocket;
	if (!socket) throw new Error('Expected the routed request to return a socket');
	socket.accept();
	await nextMessage(socket);
	socket.close(1000, 'Test complete');
});

it('rejects direct non-WebSocket room requests', async () => {
	const room = env.COLLABORATION_ROOMS.getByName('direct-no-upgrade');
	const response = await room.fetch('https://sequit.local/collab/direct-no-upgrade');

	expect(response.status).toBe(426);
	expect(await response.json()).toEqual({ error: 'WebSocket upgrade required' });
});

it('an empty room answers sync with commit zero', async () => {
	const socket = await connect('empty-sync');
	const empty = new Y.Doc();
	send(socket, syncRequest(Y.encodeStateVector(empty)));

	const response = await nextFrame(socket);
	expect(response).toEqual({
		type: CollabMessageKind.SyncResponse,
		commit: 0,
		update: Y.encodeStateAsUpdate(empty, Y.encodeStateVector(empty)),
		stateVector: Y.encodeStateVector(empty),
	});
	empty.destroy();
	socket.close(1000, 'Test complete');
});

it('non-ping text answers a JSON protocol error without broadcast', async () => {
	const sender = await connect('text-errors');
	const receiver = await connect('text-errors');

	for (const message of [
		'plain text',
		JSON.stringify(null),
		JSON.stringify('text'),
		JSON.stringify({}),
		JSON.stringify({ type: 'other' }),
	]) {
		const senderResponse = nextMessage(sender);
		sender.send(message);
		expect(JSON.parse(String((await senderResponse).data))).toEqual({
			type: CollabMessageKind.ProtocolError,
		});

		const receiverResponse = nextMessage(receiver);
		receiver.send(JSON.stringify({ type: 'ping' }));
		expect(JSON.parse(String((await receiverResponse).data))).toEqual({ type: 'pong' });
	}

	sender.close(1000, 'Test complete');
	receiver.close(1000, 'Test complete');
});

it('undecodable binary answers a binary protocol error', async () => {
	const socket = await connect('binary-error');
	socket.send(new Uint8Array([255, 255]));

	expect(await nextFrame(socket)).toMatchObject({ type: CollabMessageKind.ProtocolError });
	socket.close(1000, 'Test complete');
});

it('a change before initialization is rejected', async () => {
	const socket = await connect('change-before-init');
	send(socket, {
		type: CollabMessageKind.Proposal,
		proposalId: 'proposal-1',
		intent: ProposalIntent.Change,
		update: new Uint8Array(),
	});

	expect(await nextFrame(socket)).toMatchObject({
		type: CollabMessageKind.Rejected,
		proposalId: 'proposal-1',
		diagnostics: [{ code: 'room-not-initialized' }],
	});
	socket.close(1000, 'Test complete');
});

it('a malformed sync state vector fails alone and the next message still processes', async () => {
	const socket = await connect('serialized-errors');
	send(socket, syncRequest(new Uint8Array([255])));
	expect(await nextFrame(socket)).toEqual({
		type: CollabMessageKind.ProtocolError,
		message: 'Protocol message could not be processed',
	});

	const doc = new Y.Doc();
	send(socket, syncRequest(Y.encodeStateVector(doc)));
	expect(await nextFrame(socket)).toMatchObject({
		type: CollabMessageKind.SyncResponse,
		commit: 0,
	});
	doc.destroy();
	socket.close(1000, 'Test complete');
});

it('a last commit beyond the room answers current state', async () => {
	const socket = await connect('future-commit');
	const doc = new Y.Doc();
	send(socket, syncRequest(Y.encodeStateVector(doc), 99));
	expect(await nextFrame(socket)).toMatchObject({
		type: CollabMessageKind.SyncResponse,
		commit: 0,
	});
	doc.destroy();
	socket.close(1000, 'Test complete');
});

it('restoration from seeded multi-chunk storage survives instance replacement', async () => {
	const roomName = 'restored-room';
	const base = collaborativeDocument(roomName);
	const document = {
		...base,
		nodes: base.nodes.map((node, index) => {
			if (index === 0) return { ...node, markdown: 'x'.repeat(CHUNK_BYTES + 1) };
			return node;
		}),
	};
	const fullUpdate = encodeFullUpdate(document);
	const chunks = splitChunks(fullUpdate);
	expect(chunks.length).toBeGreaterThan(1);
	const meta: DocumentMeta = {
		commit: 7,
		chunkCount: chunks.length,
		acceptedProposals: { seeded: 7 },
	};
	await seedStorage(roomName, meta, chunks);

	const socket = await connect(roomName);
	const empty = new Y.Doc();
	send(socket, syncRequest(Y.encodeStateVector(empty)));
	const response = await nextFrame(socket);
	expect(response).toMatchObject({ type: CollabMessageKind.SyncResponse, commit: 7 });
	if (response.type !== CollabMessageKind.SyncResponse)
		throw new TypeError('Expected sync response');
	expect(response.update).toEqual(fullUpdate);
	expect(response.stateVector).toEqual(Y.encodeStateVectorFromUpdate(fullUpdate));
	empty.destroy();
	socket.close(1000, 'Test complete');
});

it('acknowledges an evicted exact replay without creating another commit', async () => {
	const roomName = 'evicted-replay';
	const authoritative = new Y.Doc();
	Y.applyUpdate(authoritative, encodeFullUpdate(collaborativeDocument(roomName)));
	const replayedUpdate = proposeChange(authoritative, (candidate) => {
		replaceNodeMarkdown(candidate, 'source-a', 'State with deletion tombstones');
	});
	Y.applyUpdate(authoritative, replayedUpdate);
	const fullUpdate = Y.encodeStateAsUpdate(authoritative);
	authoritative.destroy();
	const acceptedProposals = Object.fromEntries(
		Array.from({ length: 128 }, (_, index) => [`recent-${index}`, 129 - index]),
	);
	await seedStorage(roomName, { commit: 129, chunkCount: 1, acceptedProposals }, [fullUpdate]);
	const socket = await connect(roomName);
	send(socket, {
		type: CollabMessageKind.Proposal,
		proposalId: 'evicted-original',
		intent: ProposalIntent.Change,
		update: replayedUpdate,
	});
	const replay = await nextFrame(socket);
	expect(replay).toMatchObject({
		type: CollabMessageKind.Accepted,
		proposalId: 'evicted-original',
		commit: 129,
	});
	if (replay.type !== CollabMessageKind.Accepted) throw new TypeError('Expected acceptance');
	const unchanged = new Y.Doc();
	Y.applyUpdate(unchanged, fullUpdate);
	const stateBeforeReplay = Y.encodeStateAsUpdate(unchanged);
	Y.applyUpdate(unchanged, replay.update);
	expect(Y.encodeStateAsUpdate(unchanged)).toEqual(stateBeforeReplay);
	const empty = new Y.Doc();
	send(socket, syncRequest(Y.encodeStateVector(empty)));
	expect(await nextFrame(socket)).toMatchObject({ commit: 129 });
	unchanged.destroy();
	empty.destroy();
	socket.close(1000, 'Test complete');
});

it('persists metadata and chunks atomically and removes stale chunks', async () => {
	const roomName = 'persisted-room';
	const room = env.COLLABORATION_ROOMS.getByName(roomName);
	const fullUpdate = encodeFullUpdate(collaborativeDocument(roomName));
	const plan = planPersistence({
		fullUpdate,
		commit: 3,
		currentChunkCount: 2,
		acceptedProposals: new Map([['proposal-3', 3]]),
	});
	await runInDurableObject(room, async (_instance, state) => {
		await state.storage.put('document-chunk:1', new Uint8Array([99]));
		await persistRoomState(state.storage, plan);
		expect(await state.storage.get(META_KEY)).toEqual(plan.meta);
		expect(await state.storage.get('document-chunk:1')).toBeUndefined();
		const planWithoutStaleChunks = planPersistence({
			fullUpdate,
			commit: 3,
			currentChunkCount: plan.chunks.length,
			acceptedProposals: plan.acceptedProposals,
		});
		await persistRoomState(state.storage, planWithoutStaleChunks);
	});
});

it('rejects malformed stored document metadata', () => {
	const tooManyProposals = Object.fromEntries(
		Array.from({ length: 129 }, (_, index) => [`proposal-${index}`, 1]),
	);
	const invalidMetadata: readonly unknown[] = [
		1,
		null,
		[],
		{ chunkCount: 0, acceptedProposals: {} },
		{ commit: 'one', chunkCount: 0, acceptedProposals: {} },
		{ commit: 1.5, chunkCount: 0, acceptedProposals: {} },
		{ commit: -1, chunkCount: 0, acceptedProposals: {} },
		{ commit: 1, acceptedProposals: {} },
		{ commit: 1, chunkCount: 'one', acceptedProposals: {} },
		{ commit: 1, chunkCount: -1, acceptedProposals: {} },
		{ commit: 1, chunkCount: 16, acceptedProposals: {} },
		{ commit: 0, chunkCount: 1, acceptedProposals: {} },
		{ commit: 1, chunkCount: 0, acceptedProposals: {} },
		{ commit: 1, chunkCount: 1 },
		{ commit: 1, chunkCount: 1, acceptedProposals: 1 },
		{ commit: 1, chunkCount: 1, acceptedProposals: null },
		{ commit: 1, chunkCount: 1, acceptedProposals: [] },
		{ commit: 1, chunkCount: 1, acceptedProposals: { p: -1 } },
		{ commit: 1, chunkCount: 1, acceptedProposals: { p: 0 } },
		{ commit: 1, chunkCount: 1, acceptedProposals: { p: 2 } },
		{ commit: 1, chunkCount: 1, acceptedProposals: { '': 1 } },
		{ commit: 1, chunkCount: 1, acceptedProposals: { ['x'.repeat(129)]: 1 } },
		{ commit: 1, chunkCount: 1, acceptedProposals: tooManyProposals },
	];
	for (const metadata of invalidMetadata) {
		expect(() => parseDocumentMeta(metadata)).toThrow('Stored document metadata is invalid');
	}
});

it('rejects corrupted stored document chunks and semantic state', () => {
	const emptyDocument = new Y.Doc();
	const emptyUpdate = Y.encodeStateAsUpdate(emptyDocument);
	emptyDocument.destroy();
	const corruptions: readonly [string, DocumentMeta, readonly Uint8Array[]][] = [
		['missing-chunk', { commit: 1, chunkCount: 1, acceptedProposals: {} }, []],
		['bad-update', { commit: 1, chunkCount: 1, acceptedProposals: {} }, [new Uint8Array([255])]],
		['invalid-document', { commit: 1, chunkCount: 1, acceptedProposals: {} }, [emptyUpdate]],
		[
			'wrong-document-id',
			{ commit: 1, chunkCount: 1, acceptedProposals: {} },
			[encodeFullUpdate(collaborativeDocument('another-room'))],
		],
	];

	for (const [roomName, meta, chunks] of corruptions) {
		const keys = chunkKeys(chunks.length);
		const storedChunks = new Map(keys.map((key, index) => [key, chunks[index]]));
		expect(() => decodeStoredRoomState(meta, storedChunks, roomName)).toThrow();
	}
});

it('destroys the provisional document when storage metadata cannot be read', async () => {
	const room = env.COLLABORATION_ROOMS.getByName('restore-read-failure');
	await runInDurableObject(room, async (_instance, state) => {
		const get = vi
			.spyOn(state.storage, 'get')
			.mockRejectedValueOnce(new Error('Storage unavailable'));
		const emptyState = {
			doc: new Y.Doc(),
			commit: 0,
			chunkCount: 0,
			acceptedProposals: new Map<string, number>(),
		};
		await expect(
			restoreRoomState(state.storage, emptyState, 'restore-read-failure'),
		).rejects.toThrow('Storage unavailable');
		get.mockRestore();
	});
});

it('rejects server-only protocol messages from a client', async () => {
	const socket = await connect('unexpected-messages');
	const messages: readonly CollabMessage[] = [
		{
			type: CollabMessageKind.SyncResponse,
			commit: 0,
			update: new Uint8Array(),
			stateVector: new Uint8Array(),
		},
		{
			type: CollabMessageKind.Accepted,
			commit: 1,
			update: new Uint8Array(),
			stateVector: new Uint8Array(),
		},
		{ type: CollabMessageKind.Rejected, proposalId: 'p', diagnostics: [] },
		{ type: CollabMessageKind.ProtocolError, message: 'client error' },
	];
	for (const message of messages) {
		send(socket, message);
		expect(await nextFrame(socket)).toEqual({
			type: CollabMessageKind.ProtocolError,
			message: `Unexpected client message: ${message.type}`,
		});
	}
	socket.close(1000, 'Test complete');
});

it('closes a server-side WebSocket with the supplied details', async () => {
	const room = env.COLLABORATION_ROOMS.getByName('close-test');
	const client = await connect('close-test');
	const { promise: closed, resolve } = Promise.withResolvers<CloseEvent>();
	client.addEventListener('close', resolve, { once: true });

	await runInDurableObject(room, (instance, state) => {
		const server = state.getWebSockets().at(0);
		if (!server) throw new Error('Expected an accepted server WebSocket');
		instance.webSocketClose(server, 4100, 'Server close');
	});

	const event = await closed;
	expect(event.code).toBe(4100);
	expect(event.reason).toBe('Server close');
});

it.each([1005, 1006, 1015])(
	'acknowledges reserved close notification %s without echoing it',
	async (code) => {
		const id = `reserved-close-${code}`;
		const room = env.COLLABORATION_ROOMS.getByName(id);
		const client = await connect(id);
		const { promise: closed, resolve } = Promise.withResolvers<CloseEvent>();
		client.addEventListener('close', resolve, { once: true });
		await runInDurableObject(room, (instance, state) => {
			const server = state.getWebSockets().at(0);
			if (!server) throw new Error('Expected server socket');
			instance.webSocketClose(server, code, 'Connection ended');
		});
		expect((await closed).code).toBe(1000);
	},
);
