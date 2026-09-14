import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SessionMessageKind as Message } from '../../../src/lib/infrastructure/collaboration/session-wire';
import {
	readSyncStep,
	SyncStepKind,
	writeSyncRequest,
	writeSyncResponse,
} from '../../../src/lib/infrastructure/collaboration/sync-steps';
import { YjsCollection } from '../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { SharedElementKind as Kind } from '../../../src/lib/infrastructure/document/shared-document-command';
import { connectRoom, initializeRoom } from './room-client';

describe('CBOR session protocol contract', () => {
	it('sends both native sync steps and accepts the returning text update', async () => {
		const alice = await connectRoom('native-sync');
		const document = await initializeRoom('native-sync', alice);
		const text = document.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('A')?.get('markdown');
		if (!(text instanceof Y.Text)) throw new Error('Expected text');
		text.insert(0, 'Local ');
		alice.send({ type: Message.Sync, payload: writeSyncRequest(document) });
		expect(readSyncStep((await alice.next(Message.Sync)).payload).kind).toBe(SyncStepKind.Response);
		const request = readSyncStep((await alice.next(Message.Sync)).payload);
		if (request.kind !== SyncStepKind.Request) throw new Error('Expected step1');
		alice.send({ type: Message.Sync, payload: writeSyncResponse(document, request.stateVector) });
		expect((await alice.next(Message.Commit)).id).toBeUndefined();
		alice.socket.close();
		document.destroy();
	});

	it('broadcasts the authoritative presence list including selection and departure', async () => {
		const alice = await connectRoom('presence');
		const bob = await connectRoom('presence');
		await alice.next(Message.Presence);
		await bob.next(Message.Presence);
		alice.send({
			type: Message.Presence,
			participants: [
				{ clientId: 1, name: 'Alice', color: '#112233', selected: [{ kind: Kind.Node, id: 'A' }] },
			],
		});
		expect((await bob.next(Message.Presence)).participants).toEqual([
			{ clientId: 1, name: 'Alice', color: '#112233', selected: [{ kind: Kind.Node, id: 'A' }] },
		]);
		alice.socket.close();
		expect((await bob.next(Message.Presence)).participants).toEqual([]);
		bob.socket.close();
	});

	it.each([new Uint8Array([255]), new Uint8Array([])])(
		'rejects a malformed binary frame and closes the connection',
		async (frame) => {
			const client = await connectRoom(`malformed-${frame.length}`);
			const closed = new Promise<CloseEvent>((resolve) => {
				client.socket.addEventListener('close', resolve, { once: true });
			});
			client.socket.send(frame);
			expect((await client.next(Message.Reject)).message).toBeTruthy();
			expect((await closed).code).toBe(1008);
		},
	);
});

it.each(['null', '1', '{}', '{"type":"unknown"}', '{'])(
	'rejects invalid text control %s',
	async (value) => {
		const client = await connectRoom(`control-${encodeURIComponent(value)}`);
		client.socket.send(value);
		expect((await client.next(Message.Reject)).message).toBeTruthy();
	},
);

it('answers a ping through the text control channel', async () => {
	const client = await connectRoom('ping');
	const pong = new Promise<string>((resolve) => {
		client.socket.addEventListener('message', (event) => {
			if (typeof event.data === 'string' && event.data.includes('pong')) resolve(event.data);
		});
	});
	client.socket.send('{"type":"ping"}');
	expect(await pong).toBe('{"type":"pong"}');
	client.socket.close();
});

it.each([Message.Commit, Message.Reject])('rejects server-only %s messages', async (kind) => {
	const client = await connectRoom(`server-only-${kind}`);
	if (kind === Message.Reject) client.send({ type: Message.Reject, message: 'Forged' });
	else client.send({ type: Message.Commit, commit: 1, update: new Uint8Array([0, 0]) });
	expect((await client.next(Message.Reject)).message).toBe('Message client invalide.');
});
