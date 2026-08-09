import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
	ProposalIntent,
} from '../../../src/lib/collaboration/protocol';
import { CHUNK_BYTES } from '../../../src/lib/collaboration/room-persistence';
import { YJS_COLLECTIONS } from '../../../src/lib/collaboration/yjs-document-schema';
import {
	collaborativeDocument,
	encodeFullUpdate,
	proposeChange,
} from '../../../tests/builders/collaboration';

interface RoomClient {
	readonly socket: WebSocket;
	send(message: CollabMessage): void;
	nextFrame(): Promise<CollabMessage>;
}

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
	const { promise, resolve } = Promise.withResolvers<MessageEvent>();
	socket.addEventListener('message', resolve, { once: true });
	return promise;
}

async function connect(roomId: string): Promise<RoomClient> {
	const room = env.COLLABORATION_ROOMS.getByName(roomId);
	const response = await room.fetch(`https://sequit.local/collab/${roomId}`, {
		headers: { upgrade: 'websocket' },
	});
	const socket = response.webSocket;
	if (!socket) throw new Error('Expected a WebSocket');
	socket.binaryType = 'arraybuffer';
	socket.accept();
	await nextMessage(socket);
	return {
		socket,
		send(message): void {
			socket.send(encodeCollabMessage(message));
		},
		async nextFrame(): Promise<CollabMessage> {
			const event = await nextMessage(socket);
			if (!(event.data instanceof ArrayBuffer)) throw new TypeError('Expected binary frame');
			const decoded = decodeCollabMessage(new Uint8Array(event.data));
			if (!decoded.ok) throw new TypeError('Expected decodable frame');
			return decoded.value;
		},
	};
}

async function initialize(roomId: string, client: RoomClient): Promise<Y.Doc> {
	const update = encodeFullUpdate(collaborativeDocument(roomId));
	client.send({
		type: CollabMessageKind.Proposal,
		proposalId: 'initialize',
		intent: ProposalIntent.Initialize,
		update,
	});
	expect(await client.nextFrame()).toMatchObject({ type: CollabMessageKind.Accepted, commit: 1 });
	const doc = new Y.Doc();
	Y.applyUpdate(doc, update);
	return doc;
}

function markdownChange(doc: Y.Doc, markdown: string): Uint8Array {
	return proposeChange(doc, (candidate) => {
		const node = candidate.getMap<Y.Map<unknown>>(YJS_COLLECTIONS.nodes).get('source-a');
		const text = node?.get('markdown');
		if (!(text instanceof Y.Text)) throw new TypeError('Expected source node text');
		text.delete(0, text.length);
		text.insert(0, markdown);
	});
}

function sendChange(client: RoomClient, proposalId: string, update: Uint8Array): void {
	client.send({
		type: CollabMessageKind.Proposal,
		proposalId,
		intent: ProposalIntent.Change,
		update,
	});
}

describe('room proposal persistence', () => {
	it('an authorization failure rejects the message without changing state', async () => {
		const roomId = 'authorization-failure';
		const room = env.COLLABORATION_ROOMS.getByName(roomId);
		const client = await connect(roomId);
		const doc = await initialize(roomId, client);
		await runInDurableObject(room, (instance) => {
			Object.defineProperty(instance, 'acceptedDocument', {
				value: () => {
					throw new Error('Authorization unavailable');
				},
			});
		});

		sendChange(client, 'failed-authorization', markdownChange(doc, 'Not authorized'));
		expect(await client.nextFrame()).toEqual({
			type: CollabMessageKind.ProtocolError,
			message: 'Internal authorization failure',
		});
		client.send({
			type: CollabMessageKind.SyncRequest,
			lastCommit: 1,
			stateVector: Y.encodeStateVector(doc),
		});
		expect(await client.nextFrame()).toMatchObject({
			type: CollabMessageKind.SyncResponse,
			commit: 1,
		});
		doc.destroy();
		client.socket.close(1000, 'Test complete');
	});

	it('a persistence failure acknowledges nothing and changes nothing', async () => {
		const roomId = 'persistence-failure';
		const room = env.COLLABORATION_ROOMS.getByName(roomId);
		const client = await connect(roomId);
		const doc = await initialize(roomId, client);
		await runInDurableObject(room, (instance) => {
			Object.defineProperty(instance, 'persist', {
				value: async () => Promise.reject(new Error('Storage unavailable')),
			});
		});

		sendChange(client, 'failed-change', markdownChange(doc, 'Not persisted'));
		expect(await client.nextFrame()).toEqual({
			type: CollabMessageKind.ProtocolError,
			message: 'Internal persistence failure',
		});
		client.send({
			type: CollabMessageKind.SyncRequest,
			lastCommit: 1,
			stateVector: Y.encodeStateVector(doc),
		});
		expect(await client.nextFrame()).toMatchObject({
			type: CollabMessageKind.SyncResponse,
			commit: 1,
		});
		doc.destroy();
		client.socket.close(1000, 'Test complete');
	});

	it('an oversized document is rejected with state unchanged', async () => {
		const roomId = 'oversized-document';
		const client = await connect(roomId);
		const doc = await initialize(roomId, client);
		const oversizedMarkdown = 'x'.repeat(CHUNK_BYTES * 15);
		sendChange(client, 'oversized-change', markdownChange(doc, oversizedMarkdown));
		expect(await client.nextFrame()).toMatchObject({
			type: CollabMessageKind.Rejected,
			diagnostics: [{ code: 'document-too-large' }],
		});
		client.send({
			type: CollabMessageKind.SyncRequest,
			lastCommit: 1,
			stateVector: Y.encodeStateVector(doc),
		});
		expect(await client.nextFrame()).toMatchObject({
			type: CollabMessageKind.SyncResponse,
			commit: 1,
		});
		doc.destroy();
		client.socket.close(1000, 'Test complete');
	});
});
