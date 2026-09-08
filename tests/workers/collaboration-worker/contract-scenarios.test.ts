import { env } from 'cloudflare:workers';
import { describe, it } from 'vitest';

import {
	type CollabMessage,
	decodeCollabMessage,
	encodeCollabMessage,
} from '../../../src/lib/infrastructure/collaboration/protocol';
import {
	collaborationContractScenarios,
	type CollaborationScenarioClient,
	type CollaborationScenarioDriver,
} from '../../support/scenarios/collaboration';

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
	const { promise, resolve } = Promise.withResolvers<MessageEvent>();
	socket.addEventListener('message', resolve, { once: true });
	return promise;
}

async function connect(roomId: string): Promise<CollaborationScenarioClient> {
	const room = env.COLLABORATION_ROOMS.getByName(roomId);
	const response = await room.fetch(`https://sequit.local/collab/${roomId}`, {
		headers: { upgrade: 'websocket' },
	});
	const socket = response.webSocket;
	if (!socket) throw new Error('Expected the WebSocket upgrade to return a socket');
	socket.binaryType = 'arraybuffer';
	socket.accept();
	await nextMessage(socket);
	const queued: MessageEvent[] = [];
	const waiters: ((event: MessageEvent) => void)[] = [];
	socket.addEventListener('message', (event) => {
		const waiter = waiters.shift();
		if (waiter === undefined) queued.push(event);
		else waiter(event);
	});
	const receive = (): Promise<MessageEvent> => {
		const event = queued.shift();
		if (event !== undefined) return Promise.resolve(event);
		const { promise, resolve } = Promise.withResolvers<MessageEvent>();
		waiters.push(resolve);
		return promise;
	};
	return {
		send(message): void {
			socket.send(encodeCollabMessage(message));
		},
		async nextFrame(): Promise<CollabMessage> {
			const event = await receive();
			if (!(event.data instanceof ArrayBuffer)) throw new TypeError('Expected binary frame');
			const decoded = decodeCollabMessage(new Uint8Array(event.data));
			if (!decoded.ok) throw new TypeError('Expected decodable frame');
			return decoded.value;
		},
		async expectNoFrame(): Promise<void> {
			const responseMessage = receive();
			socket.send(JSON.stringify({ type: 'ping' }));
			const event = await responseMessage;
			if (event.data instanceof ArrayBuffer)
				throw new Error('Received an unexpected protocol frame');
			const parsed: unknown = JSON.parse(String(event.data));
			if (typeof parsed !== 'object' || parsed === null) throw new Error('Expected pong sentinel');
			if (!('type' in parsed) || parsed.type !== 'pong') throw new Error('Expected pong sentinel');
		},
		close(): void {
			socket.close(1000, 'Scenario complete');
		},
	};
}

describe('collaboration protocol contract', () => {
	for (const [index, scenario] of collaborationContractScenarios.entries()) {
		it(scenario.name, async () => {
			const driver: CollaborationScenarioDriver = {
				roomId: `contract-${index}`,
				connect: async () => connect(`contract-${index}`),
			};
			await scenario.run(driver);
		});
	}
});
