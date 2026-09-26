import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
	chunkKeys,
	type DocumentMeta,
	META_KEY,
	planPersistence,
} from '../../../src/lib/infrastructure/collaboration/room-persistence';
import {
	encodeSessionMessage,
	LEGACY_SESSION_WIRE_VERSION,
	SessionMessageKind as Message,
} from '../../../src/lib/infrastructure/collaboration/session-wire';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import worker from '../../../src/workers/collaboration-worker/index';
import {
	decodeStoredRoomState,
	parseDocumentMeta,
	persistRoomState,
	restoreRoomState,
} from '../../../src/workers/collaboration-worker/room-storage';
import { collaborativeDocument, encodeFullUpdate } from '../../support/builders/collaboration';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../support/builders/logic-document';
import { connectRoom } from './room-client';

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
	await new Promise<void>((resolve) => {
		socket.addEventListener(
			'message',
			() => {
				resolve();
			},
			{ once: true },
		);
	});
	socket.close(1000, 'Test complete');
});

it('rejects direct non-WebSocket room requests', async () => {
	const room = env.COLLABORATION_ROOMS.getByName('direct-no-upgrade');
	const response = await room.fetch('https://sequit.local/collab/direct-no-upgrade');

	expect(response.status).toBe(426);
	expect(await response.json()).toEqual({ error: 'WebSocket upgrade required' });
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

it.each([false, true])(
	'decodes stored legacy and lane documents before text upgrade (lanes=%s)',
	(lanes) => {
		const source = new Y.Doc();
		let document = validLogicDocument();
		if (lanes) document = explicitLaneLogicDocument();
		importLogicDocument(source, document);
		const plan = planPersistence({
			fullUpdate: Y.encodeStateAsUpdate(source),
			commit: 1,
			currentChunkCount: 0,
			acceptedProposals: new Map(),
		});
		const chunks = new Map(
			chunkKeys(plan.chunks.length).map((key, index) => [key, plan.chunks[index]]),
		);
		const restored = decodeStoredRoomState(plan.meta, chunks, document.id);
		const result = readLogicDocument(restored.doc);
		expect(result).toMatchObject({
			ok: true,
			value: { persistenceFormat: document.persistenceFormat },
		});
		source.destroy();
		restored.doc.destroy();
	},
);

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

it.each([false, true])(
	'restores multi-chunk snapshots and persists legacy text migration once (legacy=%s)',
	async (legacy) => {
		const name = `restore-${legacy}`;
		const stub = env.COLLABORATION_ROOMS.getByName(name);
		await runInDurableObject(stub, async (_instance, state) => {
			const source = new Y.Doc();
			Y.applyUpdate(source, encodeFullUpdate(collaborativeDocument(name)));
			const nodes = source.getMap<Y.Map<unknown>>('sequit.nodes');
			const text = nodes.get('source-a')?.get('markdown');
			if (!(text instanceof Y.Text)) throw new Error('Expected text');
			text.insert(0, 'Long content '.repeat(7000));
			if (legacy) source.getMap('sequit.meta').set('title', 'Legacy title');
			const plan = planPersistence({
				fullUpdate: Y.encodeStateAsUpdate(source),
				commit: 1,
				currentChunkCount: 0,
				acceptedProposals: new Map(),
			});
			expect(plan.chunks.length).toBeGreaterThan(1);
			await persistRoomState(state.storage, plan);
			const empty = (): ReturnType<typeof decodeStoredRoomState> => ({
				doc: new Y.Doc(),
				commit: 0,
				chunkCount: 0,
				acceptedProposals: new Map(),
			});
			const restored = await restoreRoomState(state.storage, empty(), name);
			expect(restored.doc.getMap('sequit.meta').get('title')).toBeInstanceOf(Y.Text);
			const repeated = await restoreRoomState(state.storage, empty(), name);
			expect(Y.encodeStateAsUpdate(repeated.doc)).toEqual(Y.encodeStateAsUpdate(restored.doc));
			expect(repeated.commit).toBe(restored.commit);
			source.destroy();
			restored.doc.destroy();
			repeated.doc.destroy();
		});
	},
);

it('does not publish a migration when persistence fails', async () => {
	const name = 'migration-failure';
	const stub = env.COLLABORATION_ROOMS.getByName(name);
	await runInDurableObject(stub, async (_instance, state) => {
		const source = new Y.Doc();
		Y.applyUpdate(source, encodeFullUpdate(collaborativeDocument(name)));
		source.getMap('sequit.meta').set('title', 'Legacy');
		const plan = planPersistence({
			fullUpdate: Y.encodeStateAsUpdate(source),
			commit: 1,
			currentChunkCount: 0,
			acceptedProposals: new Map(),
		});
		await persistRoomState(state.storage, plan);
		const transaction = vi
			.spyOn(state.storage, 'transaction')
			.mockRejectedValueOnce(new Error('Storage unavailable'));
		const empty = {
			doc: new Y.Doc(),
			commit: 0,
			chunkCount: 0,
			acceptedProposals: new Map<string, number>(),
		};
		await expect(restoreRoomState(state.storage, empty, name)).rejects.toThrow(
			'temporairement indisponible',
		);
		transaction.mockRestore();
		source.destroy();
	});
});

it.each([1005, 1006, 1015])(
	'acknowledges reserved close code %s without echoing it',
	async (code) => {
		const name = `reserved-close-${code}`;
		const client = await connectRoom(name);
		const closed = new Promise<CloseEvent>((resolve) => {
			client.socket.addEventListener('close', resolve, { once: true });
		});
		await runInDurableObject(env.COLLABORATION_ROOMS.getByName(name), (instance, state) => {
			const server = state.getWebSockets()[0];
			if (server === undefined) throw new Error('Missing server socket');
			instance.webSocketClose(server, code, 'Connection ended');
		});
		expect((await closed).code).toBe(1000);
	},
);

it.each([
	['obsolete-bytes', new Uint8Array([2, 255])],
	['obsolete-number', 4],
	['unversioned-record', { presence: new Uint8Array([2, 255]) }],
	[
		'wrong-message-kind',
		{ version: 5, presence: encodeSessionMessage({ type: Message.Reject, message: 'obsolete' }) },
	],
])('discards %s ephemeral presence after an attachment upgrade', async (suffix, attachment) => {
	const name = `obsolete-awareness-${suffix}`;
	const alice = await connectRoom(name);
	await alice.next(Message.Presence);
	await runInDurableObject(env.COLLABORATION_ROOMS.getByName(name), (_instance, state) => {
		const socket = state.getWebSockets()[0];
		if (socket === undefined) throw new Error('Missing socket');
		socket.serializeAttachment(attachment);
	});
	const bob = await connectRoom(name);
	expect((await bob.next(Message.Presence)).participants).toEqual([]);
	alice.socket.close();
	bob.socket.close();
});

it('shares version-four presence with a newly connected modern participant', async () => {
	const name = 'legacy-presence';
	const alice = await connectRoom(name);
	await alice.next(Message.Presence);
	alice.socket.send(
		encodeSessionMessage(
			{
				type: Message.Presence,
				participants: [{ clientId: 42, name: 'Legacy Alice', color: '#abcdef', selected: [] }],
			},
			LEGACY_SESSION_WIRE_VERSION,
		),
	);
	expect((await alice.next(Message.Presence)).participants).toMatchObject([
		{ name: 'Legacy Alice' },
	]);
	const bob = await connectRoom(name);
	expect((await bob.next(Message.Presence)).participants).toMatchObject([{ name: 'Legacy Alice' }]);
	alice.socket.close();
	bob.socket.close();
});
