import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';

import worker from '../src/index';

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
	const { promise, resolve } = Promise.withResolvers<MessageEvent>();
	socket.addEventListener('message', resolve, { once: true });
	return promise;
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

	const response = await worker.fetch(
		new Request('https://sequit.local/collab/routed', {
			headers: { upgrade: 'websocket' },
		}),
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

it('broadcasts every collaboration payload except ping control messages', async () => {
	const sender = await connect('broadcast-test');
	const receiver = await connect('broadcast-test');

	for (const message of [
		'plain text',
		JSON.stringify('text'),
		JSON.stringify(null),
		JSON.stringify({}),
		JSON.stringify({ type: 'other' }),
	]) {
		const received = nextMessage(receiver);
		sender.send(message);
		expect((await received).data).toBe(message);
	}

	const binary = new Uint8Array([1, 2, 3]).buffer;
	const receivedBinary = nextMessage(receiver);
	sender.send(binary);
	const receivedData: unknown = (await receivedBinary).data;
	if (!(receivedData instanceof ArrayBuffer)) throw new TypeError('Expected binary message data');
	expect(new Uint8Array(receivedData)).toEqual(new Uint8Array(binary));

	sender.close(1000, 'Test complete');
	receiver.close(1000, 'Test complete');
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
