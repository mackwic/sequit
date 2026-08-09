import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransportStatus } from '../../src/lib/collaboration/collaboration-transport';
import { createWebSocketCollaborationTransport } from '../../src/lib/collaboration/websocket-collaboration-transport';
import { createFakeWebSocketFactory, type FakeWebSocket } from '../harnesses/fake-websocket';

function firstSocket(sockets: readonly FakeWebSocket[]): FakeWebSocket {
	const socket = sockets[0];
	if (socket === undefined) throw new Error('Expected a socket');
	return socket;
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('websocket collaboration transport', () => {
	it('uses the browser WebSocket constructor by default', () => {
		const fake = createFakeWebSocketFactory();
		const constructor = vi.fn(function WebSocketConstructor(url: string) {
			return fake.factory(url);
		});
		vi.stubGlobal('WebSocket', constructor);
		const transport = createWebSocketCollaborationTransport('room', 'https://example.test');
		expect(constructor).toHaveBeenCalledWith('wss://example.test/collab/room');
		transport.close();
	});

	it('builds ws and wss URLs from the page origin', () => {
		const urls: string[] = [];
		const fake = createFakeWebSocketFactory();
		const factory = (url: string) => {
			urls.push(url);
			return fake.factory(url);
		};
		const insecure = createWebSocketCollaborationTransport(
			'room / one',
			'http://localhost/app',
			factory,
		);
		const secure = createWebSocketCollaborationTransport(
			'two',
			'https://example.test/app',
			factory,
		);
		expect(urls).toEqual([
			'ws://localhost/collab/room%20%2F%20one',
			'wss://example.test/collab/two',
		]);
		insecure.close();
		secure.close();
	});

	it('reports connected only after the ready control', () => {
		const fake = createFakeWebSocketFactory();
		const transport = createWebSocketCollaborationTransport(
			'room',
			'https://example.test',
			fake.factory,
		);
		const statuses: TransportStatus[] = [];
		transport.subscribeToStatus((status) => statuses.push(status));
		const socket = firstSocket(fake.sockets);
		socket.emitMessage('{bad json');
		socket.emitMessage(7);
		socket.emitMessage('null');
		socket.emitMessage('7');
		socket.emitMessage('{}');
		socket.emitMessage(JSON.stringify({ type: 1 }));
		socket.emitMessage(JSON.stringify({ type: 'ready' }));
		socket.emitMessage(JSON.stringify({ type: 'ready' }));
		expect(transport.status()).toBe(TransportStatus.Connected);
		expect(statuses).toEqual([TransportStatus.Connected]);
		transport.close();
	});

	it('ignores pong and unknown controls', () => {
		const fake = createFakeWebSocketFactory();
		const transport = createWebSocketCollaborationTransport(
			'room',
			'https://example.test',
			fake.factory,
		);
		const statuses = vi.fn();
		transport.subscribeToStatus(statuses);
		const socket = firstSocket(fake.sockets);
		socket.emitMessage(JSON.stringify({ type: 'pong' }));
		socket.emitMessage(JSON.stringify({ type: 'other' }));
		expect(statuses).not.toHaveBeenCalled();
		transport.close();
	});

	it('forwards binary frames as bytes', () => {
		const fake = createFakeWebSocketFactory();
		const transport = createWebSocketCollaborationTransport(
			'room',
			'https://example.test',
			fake.factory,
		);
		const frames: Uint8Array[] = [];
		const unsubscribe = transport.subscribeToFrames((frame) => frames.push(frame));
		firstSocket(fake.sockets).emitMessage(new Uint8Array([1, 2, 3]).buffer);
		expect(frames).toEqual([new Uint8Array([1, 2, 3])]);
		unsubscribe();
		transport.close();
	});

	it('drops sends while disconnected', () => {
		const fake = createFakeWebSocketFactory();
		const transport = createWebSocketCollaborationTransport(
			'room',
			'https://example.test',
			fake.factory,
		);
		const socket = firstSocket(fake.sockets);
		transport.send(new Uint8Array([1]));
		socket.emitMessage(JSON.stringify({ type: 'ready' }));
		socket.readyState = 0;
		transport.send(new Uint8Array([2]));
		socket.readyState = 1;
		transport.send(new Uint8Array([3]));
		expect(socket.sent).toEqual([new Uint8Array([3])]);
		transport.close();
	});

	it('backs off exponentially to the cap and reports connected again after ready', () => {
		vi.useFakeTimers();
		const fake = createFakeWebSocketFactory();
		const transport = createWebSocketCollaborationTransport(
			'room',
			'https://example.test',
			fake.factory,
		);
		const statuses: TransportStatus[] = [];
		transport.subscribeToStatus((status) => statuses.push(status));
		for (let index = 0; index < 7; index += 1) {
			const socket = fake.sockets.at(-1);
			if (socket === undefined) throw new Error('Expected socket');
			socket.emitMessage(JSON.stringify({ type: 'ready' }));
			socket.emitClose();
			vi.runAllTimers();
		}
		expect(fake.sockets).toHaveLength(8);
		expect(statuses).toContain(TransportStatus.Disconnected);
		transport.close();
	});

	it('close stops reconnection and closes with code 1000', () => {
		vi.useFakeTimers();
		const fake = createFakeWebSocketFactory();
		const transport = createWebSocketCollaborationTransport(
			'room',
			'https://example.test',
			fake.factory,
		);
		const socket = firstSocket(fake.sockets);
		socket.emitClose();
		transport.close();
		transport.close();
		vi.runAllTimers();
		expect(fake.sockets).toHaveLength(1);
		expect(socket.closeCodes).toEqual([1000]);
	});

	it('closing removes every listener', () => {
		const fake = createFakeWebSocketFactory();
		const transport = createWebSocketCollaborationTransport(
			'room',
			'https://example.test',
			fake.factory,
		);
		const socket = firstSocket(fake.sockets);
		const unsubscribeFrame = transport.subscribeToFrames(vi.fn());
		const unsubscribeStatus = transport.subscribeToStatus(vi.fn());
		unsubscribeFrame();
		unsubscribeStatus();
		transport.close();
		expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
	});

	it('ignores non-message events and duplicate close scheduling', () => {
		vi.useFakeTimers();
		const fake = createFakeWebSocketFactory();
		const transport = createWebSocketCollaborationTransport(
			'room',
			'https://example.test',
			fake.factory,
		);
		const socket = firstSocket(fake.sockets);
		const messageListener = [...(socket.listeners.get('message') ?? [])][0];
		const closeListener = [...(socket.listeners.get('close') ?? [])][0];
		if (messageListener === undefined || closeListener === undefined)
			throw new Error('Expected socket listeners');
		messageListener({ code: 1006 });
		closeListener({ code: 1006 });
		closeListener({ code: 1006 });
		vi.advanceTimersByTime(1_000);
		expect(fake.sockets).toHaveLength(2);
		transport.close();
	});
});
