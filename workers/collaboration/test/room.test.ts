import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';

it('accepts a room connection and answers a ping', async () => {
	const room = env.COLLABORATION_ROOMS.getByName('connection-test');
	const response = await room.fetch('https://sequit.local/collab/connection-test', {
		headers: { upgrade: 'websocket' }
	});

	expect(response.status).toBe(101);
	expect(response.webSocket).not.toBeNull();

	const socket = response.webSocket!;
	const readyMessage = new Promise<MessageEvent>((resolve) =>
		socket.addEventListener('message', resolve, { once: true })
	);
	socket.accept();

	expect(JSON.parse(String((await readyMessage).data))).toEqual({ type: 'ready' });

	const pongMessage = new Promise<MessageEvent>((resolve) =>
		socket.addEventListener('message', resolve, { once: true })
	);
	socket.send(JSON.stringify({ type: 'ping' }));

	expect(JSON.parse(String((await pongMessage).data))).toEqual({ type: 'pong' });
	socket.close(1000, 'Test complete');
});
