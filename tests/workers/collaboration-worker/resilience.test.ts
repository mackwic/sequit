import { encode } from 'cborg';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { SessionFailureCode } from '../../../src/lib/infrastructure/collaboration/session-failure';
import {
	encodeSessionMessage,
	SESSION_WIRE_VERSION,
	SessionMessageKind as Message,
} from '../../../src/lib/infrastructure/collaboration/session-wire';
import { readLogicDocument } from '../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../src/lib/infrastructure/document/shared-document-command';
import { connectRoom, initializeRoom } from './room-client';

function color(sessionId: string, sequence: number, value: string) {
	return {
		type: Message.Change,
		id: `${sessionId}-${sequence}`,
		sessionId,
		sequence,
		commands: [
			{ op: Op.Update, target: { kind: Kind.Node, id: 'A' }, set: { color: value }, unset: [] },
		],
	} as const;
}

it('never reexecutes an old command after 150 later commands and a real room eviction', async () => {
	const name = 'durable-receipts';
	const alice = await connectRoom(name);
	const doc = await initializeRoom(name, alice);
	const command = color('alice', 1, '#ff0000');
	alice.send(command);
	await alice.next(Message.Commit); // Simulate loss at Alice's pending-command layer.
	for (let sequence = 1; sequence <= 150; sequence++) {
		alice.send(color('bob', sequence, '#0000ff'));
		await alice.next(Message.Commit);
	}
	await evictDurableObject(env.COLLABORATION_ROOMS.getByName(name));
	alice.send(command);
	const replay = await alice.next(Message.Commit);
	Y.applyUpdate(doc, replay.update);
	expect(replay.commit).toBe(152);
	expect(readLogicDocument(doc)).toMatchObject({
		ok: true,
		value: { nodes: [expect.objectContaining({ id: 'A', color: '#0000ff' }), expect.anything()] },
	});
	alice.send(color('alice', 2, '#00ff00'));
	expect((await alice.next(Message.Commit)).commit).toBe(153);
	alice.socket.close();
	doc.destroy();
});

it('rejects command gaps recoverably and persists progress atomically with document data', async () => {
	const name = 'gaps-and-retry';
	const client = await connectRoom(name);
	const doc = await initializeRoom(name, client);
	client.send(color('session', 2, '#0000ff'));
	expect((await client.next(Message.Retry)).code).toBe(SessionFailureCode.CommandGap);
	const stub = env.COLLABORATION_ROOMS.getByName(name);
	await runInDurableObject(stub, (_room, state) => {
		vi.spyOn(state.storage, 'transaction').mockRejectedValueOnce(new Error('Transient outage'));
	});
	client.send(color('session', 1, '#ff0000'));
	expect((await client.next(Message.Retry)).code).toBe(SessionFailureCode.StorageUnavailable);
	await runInDurableObject(stub, async (_room, state) => {
		expect(await state.storage.get('command-session:session')).toBeUndefined();
		vi.restoreAllMocks();
	});
	client.send(color('session', 1, '#ff0000'));
	expect((await client.next(Message.Commit)).commit).toBe(2);
	client.send(color('session', 2, '#0000ff'));
	expect((await client.next(Message.Commit)).commit).toBe(3);
	client.send(color('session', 1, '#ff0000'));
	const replay = await client.next(Message.Commit);
	expect(replay.commit).toBe(3);
	Y.applyUpdate(doc, replay.update);
	expect(readLogicDocument(doc)).toMatchObject({
		ok: true,
		value: { nodes: [expect.objectContaining({ color: '#0000ff' }), expect.anything()] },
	});
	client.socket.close();
	doc.destroy();
});

it('keeps all 50 participants connected when a selection is huge and delivers document edits to everyone', async () => {
	const name = 'fifty-participants';
	const clients = await Promise.all(Array.from({ length: 50 }, () => connectRoom(name)));
	const author = clients[0];
	if (author === undefined) throw new Error('Expected author');
	const doc = await initializeRoom(name, author);
	await Promise.all(clients.slice(1).map((client) => client.next(Message.Commit)));
	for (const [index, client] of clients.entries()) {
		client.send({
			type: Message.Presence,
			participants: [
				{
					clientId: index,
					name: `Person ${index}`,
					color: '#123456',
					selected: Array.from({ length: 1000 }, (_, item) => ({
						kind: Kind.Node,
						id: `00000000-0000-4000-8000-${String(item).padStart(12, '0')}`,
					})),
				},
			],
		});
	}
	await Promise.all(
		clients.map(async (client) => {
			for (;;) {
				const presence = await client.next(Message.Presence);
				if (presence.participants.length !== 50) continue;
				expect(presence.participants.every(({ selected }) => selected.length === 16)).toBe(true);
				expect(encodeSessionMessage(presence).byteLength).toBeLessThan(100_000);
				return;
			}
		}),
	);
	author.send(color('author', 1, '#abcdef'));
	const commits = await Promise.all(clients.map((client) => client.next(Message.Commit)));
	expect(commits.every(({ commit }) => commit === 2)).toBe(true);
	for (const client of clients) {
		expect(client.socket.readyState).toBe(WebSocket.OPEN);
		client.socket.close();
	}
	doc.destroy();
});

it('ignores invalid ephemeral presence and failed attachments while continuing document commands', async () => {
	const name = 'ephemeral-failures';
	const client = await connectRoom(name);
	const doc = await initializeRoom(name, client);
	client.socket.send(
		encode([
			SESSION_WIRE_VERSION,
			{
				type: 'presence',
				participants: [{ clientId: 1, name: 'Alice', color: '#123456', selected: 'invalid' }],
			},
		]),
	);
	client.socket.send(
		encode([SESSION_WIRE_VERSION, { type: 'presence', participants: [], unexpected: true }]),
	);
	await runInDurableObject(env.COLLABORATION_ROOMS.getByName(name), (_room, state) => {
		const socket = state.getWebSockets()[0];
		if (socket === undefined) throw new Error('Expected socket');
		vi.spyOn(socket, 'serializeAttachment').mockImplementationOnce(() => {
			throw new Error('Attachment unavailable');
		});
	});
	client.send({
		type: Message.Presence,
		participants: [{ clientId: 1, name: 'Alice', color: '#123456', selected: [] }],
	});
	client.send(color('author', 1, '#abcdef'));
	expect((await client.next(Message.Commit)).commit).toBe(2);
	client.socket.close();
	doc.destroy();
});

it.each(['invalid', 0, 1.5])(
	'does not guess or advance malformed durable command progress: %s',
	async (value) => {
		const name = `bad-receipt-${String(value)}`;
		const client = await connectRoom(name);
		const doc = await initializeRoom(name, client);
		await runInDurableObject(env.COLLABORATION_ROOMS.getByName(name), async (_room, state) => {
			await state.storage.put('command-session:author', value);
		});
		client.send(color('author', 1, '#abcdef'));
		expect((await client.next(Message.Reject)).code).toBe(SessionFailureCode.CorruptCommandReceipt);
		await new Promise<void>((resolve) => {
			client.socket.addEventListener(
				'close',
				() => {
					resolve();
				},
				{ once: true },
			);
		});
		expect(client.socket.readyState).toBe(WebSocket.CLOSED);
		const unaffected = await connectRoom(name);
		unaffected.send(color('different-session', 1, '#abcdef'));
		expect((await unaffected.next(Message.Commit)).commit).toBe(2);
		unaffected.socket.close();
		doc.destroy();
	},
);

it('bounds the control channel before JSON decoding', async () => {
	const client = await connectRoom('large-control');
	client.socket.send('x'.repeat(1025));
	expect((await client.next(Message.Reject)).code).toBe(SessionFailureCode.InvalidMessage);
});
