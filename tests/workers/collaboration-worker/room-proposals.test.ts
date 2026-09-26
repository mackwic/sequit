import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { META_KEY } from '../../../src/lib/infrastructure/collaboration/room-persistence';
import {
	encodeSessionMessage,
	LEGACY_SESSION_WIRE_VERSION,
	SessionMessageKind as Message,
} from '../../../src/lib/infrastructure/collaboration/session-wire';
import {
	CHUNK_KEY_PREFIX,
	META_KEY,
} from '../../../src/lib/infrastructure/collaboration/room-persistence';
import {
	decodeSessionMessage,
	SessionMessageKind as Message,
} from '../../../src/lib/infrastructure/collaboration/session-wire';
import {
	readSyncStep,
	SyncStepKind,
	writeSyncRequest,
	writeSyncResponse,
} from '../../../src/lib/infrastructure/collaboration/sync-steps';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../src/lib/infrastructure/document/shared-document-command';
import { proposeChange } from '../../support/builders/collaboration';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../support/fixtures/collaborative-document';
import { connectRoom, initializeRoom } from './room-client';

describe('room authority', () => {
	it('persists structural commands before broadcasting and deduplicates their IDs', async () => {
		const room = 'structural';
		const alice = await connectRoom(room);
		const bob = await connectRoom(room);
		const doc = await initializeRoom(room, alice);
		await bob.next(Message.Commit);
		const command = {
			type: Message.Change,
			id: 'link',
			sessionId: 'test-session',
			sequence: 1,
			commands: [
				{
					op: Op.Create,
					target: { kind: Kind.Relation, id: 'R' },
					properties: { from: 'B', to: 'A' },
				},
			],
		} as const;
		alice.send(command);
		const accepted = await alice.next(Message.Commit);
		const remote = await bob.next(Message.Commit);
		expect(remote).toMatchObject({ commit: accepted.commit, update: accepted.update });
		expect(remote.id).toBeUndefined();
		Y.applyUpdate(doc, remote.update);
		expect(readLogicDocument(doc)).toMatchObject({
			ok: true,
			value: { relations: [{ id: 'R', from: 'B', to: 'A' }] },
		});
		await runInDurableObject(env.COLLABORATION_ROOMS.getByName(room), async (_instance, state) => {
			expect(await state.storage.get(META_KEY)).toMatchObject({
				commit: 2,
			});
			expect(await state.storage.get('command-session:test-session')).toBe(1);
		});
		alice.send(command);
		const replay = await alice.next(Message.Commit);
		expect(replay.commit).toBe(2);
		alice.socket.close();
		bob.socket.close();
		doc.destroy();
	});

	it.each([Message.Change, Message.Sync])(
		'validates structure hidden in a %s update before it reaches other clients',
		async (channel) => {
			const room = `text-boundary-${channel}`;
			const alice = await connectRoom(room);
			const bob = await connectRoom(room);
			const doc = await initializeRoom(room, alice);
			const bobDocument = new Y.Doc();
			const initialCommit = await bob.next(Message.Commit);
			Y.applyUpdate(bobDocument, initialCommit.update);
			expect(readLogicDocument(bobDocument).ok).toBe(true);
			const bobCommits: { update: Uint8Array; valid: boolean }[] = [];
			bob.socket.addEventListener('message', (event) => {
				if (!(event.data instanceof ArrayBuffer)) return;
				const message = decodeSessionMessage(new Uint8Array(event.data));
				if (message.type !== Message.Commit) return;
				Y.applyUpdate(bobDocument, message.update);
				bobCommits.push({ update: message.update, valid: readLogicDocument(bobDocument).ok });
			});
			const storedBefore = await runInDurableObject(
				env.COLLABORATION_ROOMS.getByName(room),
				async (_instance, state) => ({
					meta: await state.storage.get(META_KEY),
					document: await state.storage.get(`${CHUNK_KEY_PREFIX}0`),
				}),
			);
			const update = proposeChange(doc, (candidate) => {
				candidate.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('A')?.set('color', '#ff0000');
			});
			if (channel === Message.Change) alice.send({ type: Message.Change, update });
			else {
				const changed = new Y.Doc();
				Y.applyUpdate(changed, Y.encodeStateAsUpdate(doc));
				Y.applyUpdate(changed, update);
				alice.send({
					type: Message.Sync,
					payload: writeSyncResponse(changed, Y.encodeStateVector(doc)),
				});
				changed.destroy();
			}
			const closed = new Promise<CloseEvent>((resolve) => {
				alice.socket.addEventListener('close', resolve, { once: true });
			});
			expect((await alice.next(Message.Reject)).message).toBeTruthy();
			expect((await closed).code).toBe(1008);
			expect(bobCommits).toHaveLength(0);
			bob.send({ type: Message.Sync, payload: writeSyncRequest(bobDocument) });
			const synced = readSyncStep((await bob.next(Message.Sync)).payload);
			expect(synced.kind).toBe(SyncStepKind.Response);
			if (synced.kind !== SyncStepKind.Response) throw new Error('Expected room sync response');
			Y.applyUpdate(bobDocument, synced.update);
			expect(readLogicDocument(bobDocument)).toEqual(readLogicDocument(doc));
			expect(readLogicDocument(bobDocument).ok).toBe(true);
			const afterReject = await runInDurableObject(
				env.COLLABORATION_ROOMS.getByName(room),
				async (_instance, state) => ({
					meta: await state.storage.get(META_KEY),
					document: await state.storage.get(`${CHUNK_KEY_PREFIX}0`),
				}),
			);
			expect(afterReject).toEqual(storedBefore);
			bob.send({
				type: Message.Change,
				id: 'valid-follow-up',
				sessionId: 'valid-follow-up',
				sequence: 1,
				commands: [
					{
						op: Op.Update,
						target: { kind: Kind.Node, id: 'A' },
						set: { color: '#00ff00' },
						unset: [],
					},
				],
			});
			const bobCommit = await bob.next(Message.Commit);
			const bobResult = readLogicDocument(bobDocument);
			expect(bobResult.ok).toBe(true);
			expect(bobCommits).toHaveLength(1);
			expect(bobCommits).toEqual([{ update: bobCommit.update, valid: true }]);
			alice.socket.close();
			bob.socket.close();
			doc.destroy();
			bobDocument.destroy();
		},
	);

	it('rejects a cycle and continues serving the unaffected participant', async () => {
		const room = 'cycle';
		const alice = await connectRoom(room);
		const bob = await connectRoom(room);
		const doc = await initializeRoom(room, alice, CollaborativeFixture.LinkedBoxes);
		await bob.next(Message.Commit);
		alice.send({
			type: Message.Change,
			id: 'cycle',
			sessionId: 'test-session',
			sequence: 1,
			commands: [
				{
					op: Op.Create,
					target: { kind: Kind.Relation, id: 'cycle' },
					properties: { from: 'A', to: 'B' },
				},
			],
		});
		expect(await alice.next(Message.Conflict)).toMatchObject({
			id: 'cycle',
			code: 'invalid-command',
			lastAcceptedSequence: 0,
		});
		expect(alice.socket.readyState).toBe(WebSocket.OPEN);
		bob.send({ type: Message.Sync, payload: writeSyncRequest(new Y.Doc()) });
		expect((await bob.next(Message.Sync)).payload).toBeInstanceOf(Uint8Array);
		bob.socket.close();
		doc.destroy();
	});

	it('rejects cyclic initialization before any participant receives a commit', async () => {
		const room = 'cyclic-initialization';
		const watcher = await connectRoom(room);
		const commits: Uint8Array[] = [];
		watcher.socket.addEventListener('message', (event) => {
			if (!(event.data instanceof ArrayBuffer)) return;
			const message = decodeSessionMessage(new Uint8Array(event.data));
			if (message.type === Message.Commit) commits.push(message.update);
		});
		const invalidSender = await connectRoom(room);
		const invalid = new Y.Doc();
		importLogicDocument(invalid, collaborativeFixture(CollaborativeFixture.LinkedBoxes, room));
		invalid
			.getMap<Y.Map<unknown>>(YjsCollection.Relations)
			.set('initial-cycle', createYjsEntityMap({ from: 'A', to: 'B' }));
		invalidSender.send({
			type: Message.Initialize,
			id: 'cyclic-initialize',
			update: Y.encodeStateAsUpdate(invalid),
		});
		expect((await invalidSender.next(Message.Reject)).message).toBeTruthy();
		expect(commits).toHaveLength(0);
		await runInDurableObject(env.COLLABORATION_ROOMS.getByName(room), async (_instance, state) => {
			expect(await state.storage.get(META_KEY)).toBeUndefined();
		});
		invalidSender.socket.close();
		const validSender = await connectRoom(room);
		const initialized = await initializeRoom(room, validSender, CollaborativeFixture.TwoBoxes);
		const peerCommit = await watcher.next(Message.Commit);
		const peerDocument = new Y.Doc();
		Y.applyUpdate(peerDocument, peerCommit.update);
		expect(readLogicDocument(peerDocument).ok).toBe(true);
		expect(commits).toHaveLength(1);
		validSender.socket.close();
		watcher.socket.close();
		invalid.destroy();
		initialized.destroy();
		peerDocument.destroy();
	});

	it('closes a session that repeatedly retries the same refused proposal without advancing its receipt', async () => {
		const room = 'repeated-business-refusal';
		const alice = await connectRoom(room);
		const bob = await connectRoom(room);
		const doc = await initializeRoom(room, alice, CollaborativeFixture.LinkedBoxes);
		await bob.next(Message.Commit);
		const refused = {
			type: Message.Change,
			id: 'same-invalid-gesture',
			sessionId: 'repeated-session',
			sequence: 1,
			commands: [
				{
					op: Op.Create,
					target: { kind: Kind.Relation, id: 'cycle' },
					properties: { from: 'A', to: 'B' },
				},
			],
		} as const;
		const closed = new Promise<CloseEvent>((resolve) => {
			alice.socket.addEventListener('close', resolve, { once: true });
		});
		for (let attempt = 0; attempt < 6; attempt++) {
			alice.send(refused);
			expect((await alice.next(Message.Conflict)).lastAcceptedSequence).toBe(0);
			if (attempt === 0)
				alice.send({
					type: Message.Presence,
					participants: [{ clientId: 7, name: 'Alice', color: '#aabbcc', selected: [] }],
				});
		}
		alice.send(refused);
		expect(await alice.next(Message.Reject)).toMatchObject({ code: 'repeated-command-refusal' });
		expect((await closed).code).toBe(1008);
		await runInDurableObject(env.COLLABORATION_ROOMS.getByName(room), async (_instance, state) => {
			expect(await state.storage.get('command-session:repeated-session')).toBeUndefined();
		});
		bob.send({
			type: Message.Change,
			id: 'independent',
			sessionId: 'bob-session',
			sequence: 1,
			commands: [{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }],
		});
		expect((await bob.next(Message.Commit)).id).toBe('independent');
		bob.socket.close();
		doc.destroy();
	});

	it('uses legacy v4 rejection for an old socket while preserving newer participants', async () => {
		const name = 'mixed-protocol';
		const legacy = await connectRoom(name);
		const modern = await connectRoom(name);
		const doc = await initializeRoom(name, modern, CollaborativeFixture.LinkedBoxes);
		await legacy.next(Message.Commit);
		const closed = new Promise<CloseEvent>((resolve) => {
			legacy.socket.addEventListener('close', resolve, { once: true });
		});
		legacy.socket.send(
			encodeSessionMessage(
				{
					type: Message.Change,
					id: 'old-cycle',
					sessionId: 'old-session',
					sequence: 1,
					commands: [
						{
							op: Op.Create,
							target: { kind: Kind.Relation, id: 'cycle' },
							properties: { from: 'A', to: 'B' },
						},
					],
				},
				LEGACY_SESSION_WIRE_VERSION,
			),
		);
		expect((await legacy.next(Message.Reject)).message).toBeTruthy();
		expect((await closed).code).toBe(1008);
		modern.send({
			type: Message.Change,
			id: 'still-valid',
			sessionId: 'modern-session',
			sequence: 1,
			commands: [{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }],
		});
		expect((await modern.next(Message.Commit)).id).toBe('still-valid');
		modern.socket.close();
		doc.destroy();
	});

	it('does not merge two initial documents racing for the same room', async () => {
		const room = 'initialize-race';
		const alice = await connectRoom(room);
		const doc = await initializeRoom(room, alice);
		const bob = await connectRoom(room);
		bob.send({ type: Message.Initialize, id: 'second-init', update: new Uint8Array([255]) });
		const result = await bob.next(Message.Commit);
		expect(result.commit).toBe(1);
		const accepted = new Y.Doc();
		Y.applyUpdate(accepted, result.update);
		expect(readLogicDocument(accepted)).toEqual(readLogicDocument(doc));
		alice.socket.close();
		bob.socket.close();
		doc.destroy();
		accepted.destroy();
	});

	it.each([new Error('Storage unavailable'), 'Storage unavailable'])(
		'rejects persistence failure without publishing or mutating the accepted document: %s',
		async (failure) => {
			const room = 'persistence-failure';
			const alice = await connectRoom(room);
			const doc = await initializeRoom(room, alice);
			const stub = env.COLLABORATION_ROOMS.getByName(room);
			await runInDurableObject(stub, (_instance, state) => {
				vi.spyOn(state.storage, 'transaction').mockRejectedValueOnce(failure);
			});
			alice.send({
				type: Message.Change,
				id: 'delete',
				sessionId: 'test-session',
				sequence: 1,
				commands: [{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }],
			});
			const rejection = await alice.next(Message.Retry);
			expect(rejection.code).toBe('storage-unavailable');
			await runInDurableObject(stub, async (_instance, state) => {
				vi.restoreAllMocks();
				expect(await state.storage.get(META_KEY)).toMatchObject({ commit: 1 });
				expect(await state.storage.get('command-session:test-session')).toBeUndefined();
			});
			alice.socket.close();
			doc.destroy();
		},
	);
});

it('requires initialization and rejects a snapshot for another room', async () => {
	const empty = await connectRoom('not-initialized');
	empty.send({
		type: Message.Change,
		id: 'premature',
		sessionId: 'test-session',
		sequence: 1,
		commands: [{ op: Op.Delete, target: { kind: Kind.Node, id: 'A' } }],
	});
	expect((await empty.next(Message.Reject)).message).toContain('Initialisez');
	const source = await connectRoom('snapshot-source');
	const doc = await initializeRoom('snapshot-source', source);
	const wrong = await connectRoom('snapshot-target');
	wrong.send({ type: Message.Initialize, id: 'wrong-room', update: Y.encodeStateAsUpdate(doc) });
	expect((await wrong.next(Message.Reject)).message).toContain('room');
	source.socket.close();
	doc.destroy();
});

it('rejects malformed initialization and empty-room text but ignores malformed presence', async () => {
	const initial = await connectRoom('malformed-initial');
	initial.send({ type: Message.Initialize, id: 'bad', update: new Uint8Array([255]) });
	await initial.next(Message.Reject);
	const empty = await connectRoom('text-without-doc');
	const text = new Y.Doc();
	text.getText('text').insert(0, 'Uninitialized');
	empty.send({ type: Message.Change, update: Y.encodeStateAsUpdate(text) });
	await empty.next(Message.Reject);
	text.destroy();
	const presence = await connectRoom('invalid-presence');
	presence.send({ type: Message.Presence, participants: [] });
	const initialized = await initializeRoom('invalid-presence', presence);
	expect(readLogicDocument(initialized).ok).toBe(true);
	initialized.destroy();
	presence.socket.close();
});

it('keeps the rejected batch atomic and accepts the corrected next command', async () => {
	const name = 'atomic-batch';
	const client = await connectRoom(name);
	const doc = await initializeRoom(name, client);
	client.send({
		type: Message.Change,
		id: 'batch',
		sessionId: 'test-session',
		sequence: 1,
		commands: [
			{ op: Op.Update, target: { kind: Kind.Node, id: 'A' }, set: { color: '#aabbcc' }, unset: [] },
			{ op: Op.Delete, target: { kind: Kind.Node, id: 'missing' } },
		],
	});
	client.send({
		type: Message.Change,
		id: 'after-rejection',
		sessionId: 'test-session',
		sequence: 1,
		commands: [{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }],
	});
	expect(await client.next(Message.Conflict)).toMatchObject({
		id: 'batch',
		lastAcceptedSequence: 0,
	});
	expect((await client.next(Message.Commit)).id).toBe('after-rejection');
	await runInDurableObject(env.COLLABORATION_ROOMS.getByName(name), async (_instance, state) => {
		expect(await state.storage.get(META_KEY)).toMatchObject({ commit: 2 });
	});
	client.socket.close();
	doc.destroy();
});

it('does not allocate command IDs or persist another commit for replayed text', async () => {
	const name = 'text-idempotence';
	const client = await connectRoom(name);
	const doc = await initializeRoom(name, client);
	const update = proposeChange(doc, (candidate) => {
		const text = candidate.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('A')?.get('markdown');
		if (!(text instanceof Y.Text)) throw new Error('Missing text');
		text.delete(0, 1);
		text.insert(0, 'a');
	});
	client.send({ type: Message.Change, update });
	expect((await client.next(Message.Commit)).id).toBeUndefined();
	client.send({ type: Message.Change, update });
	const pong = new Promise<void>((resolve) => {
		client.socket.addEventListener('message', (event) => {
			if (event.data === '{"type":"pong"}') resolve();
		});
	});
	client.socket.send('{"type":"ping"}');
	await pong;
	await runInDurableObject(env.COLLABORATION_ROOMS.getByName(name), async (_instance, state) => {
		expect(await state.storage.get(META_KEY)).toMatchObject({
			commit: 2,
			acceptedProposals: { initialize: 1 },
		});
	});
	client.socket.close();
	doc.destroy();
});
