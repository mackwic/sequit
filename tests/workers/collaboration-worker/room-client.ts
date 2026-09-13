import { env } from 'cloudflare:workers';
import * as Y from 'yjs';

import {
	decodeSessionMessage,
	encodeSessionMessage,
	type SessionMessage,
	SessionMessageKind,
} from '../../../src/lib/infrastructure/collaboration/session-wire';
import { importLogicDocument } from '../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../support/fixtures/collaborative-document';

function hasKind<K extends SessionMessageKind>(
	message: SessionMessage,
	kind: K,
): message is Extract<SessionMessage, { readonly type: K }> {
	return message.type === kind;
}

export interface RoomClient {
	readonly socket: WebSocket;
	send(message: SessionMessage): void;
	next<K extends SessionMessageKind>(
		kind: K,
	): Promise<Extract<SessionMessage, { readonly type: K }>>;
}

export async function connectRoom(room: string): Promise<RoomClient> {
	const response = await env.COLLABORATION_ROOMS.getByName(room).fetch(
		`https://sequit.local/collab/${room}`,
		{ headers: { upgrade: 'websocket' } },
	);
	const socket = response.webSocket;
	if (socket === null) throw new Error('Expected socket');
	socket.binaryType = 'arraybuffer';
	const queued: SessionMessage[] = [];
	const waiters: ((message: SessionMessage) => void)[] = [];
	socket.addEventListener('message', (event) => {
		if (!(event.data instanceof ArrayBuffer)) return;
		const message = decodeSessionMessage(new Uint8Array(event.data));
		const waiter = waiters.shift();
		if (waiter === undefined) queued.push(message);
		else waiter(message);
	});
	socket.accept();
	const receive = (): Promise<SessionMessage> => {
		const message = queued.shift();
		if (message !== undefined) return Promise.resolve(message);
		return new Promise((resolve) => {
			waiters.push(resolve);
		});
	};
	return {
		socket,
		send(message): void {
			socket.send(encodeSessionMessage(message));
		},
		async next<K extends SessionMessageKind>(
			kind: K,
		): Promise<Extract<SessionMessage, { readonly type: K }>> {
			for (;;) {
				const message = await receive();
				if (hasKind(message, kind)) return message;
			}
		},
	};
}

export async function initializeRoom(
	room: string,
	client: RoomClient,
	fixture = CollaborativeFixture.TwoBoxes,
): Promise<Y.Doc> {
	const initial = new Y.Doc();
	importLogicDocument(initial, collaborativeFixture(fixture, room));
	client.send({
		type: SessionMessageKind.Initialize,
		id: 'initialize',
		update: Y.encodeStateAsUpdate(initial),
	});
	const committed = await client.next(SessionMessageKind.Commit);
	const document = new Y.Doc();
	Y.applyUpdate(document, committed.update);
	initial.destroy();
	return document;
}
