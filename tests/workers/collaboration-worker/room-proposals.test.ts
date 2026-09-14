import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { META_KEY } from '../../../src/lib/infrastructure/collaboration/room-persistence';
import { SessionMessageKind as Message } from '../../../src/lib/infrastructure/collaboration/session-wire';
import {
	writeSyncRequest,
	writeSyncResponse,
} from '../../../src/lib/infrastructure/collaboration/sync-steps';
import { readLogicDocument } from '../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../src/lib/infrastructure/document/shared-document-command';
import { proposeChange } from '../../support/builders/collaboration';
import { CollaborativeFixture } from '../../support/fixtures/collaborative-document';
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
		expect(remote).toEqual(accepted);
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
			const doc = await initializeRoom(room, alice);
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
			await runInDurableObject(
				env.COLLABORATION_ROOMS.getByName(room),
				async (_instance, state) => {
					expect(await state.storage.get(META_KEY)).toMatchObject({ commit: 1 });
				},
			);
			doc.destroy();
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
		await alice.next(Message.Reject);
		bob.send({ type: Message.Sync, payload: writeSyncRequest(new Y.Doc()) });
		expect((await bob.next(Message.Sync)).payload).toBeInstanceOf(Uint8Array);
		bob.socket.close();
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

it('keeps the batch atomic when a later command fails and ignores messages queued after rejection', async () => {
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
	await client.next(Message.Reject);
	await runInDurableObject(env.COLLABORATION_ROOMS.getByName(name), async (_instance, state) => {
		expect(await state.storage.get(META_KEY)).toMatchObject({ commit: 1 });
	});
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
