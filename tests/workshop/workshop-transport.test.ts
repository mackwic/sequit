import { expect, it, vi } from 'vitest';

import {
	type CollaborationTransport,
	TransportStatus,
} from '../../src/lib/collaboration/collaboration-transport';
import { WorkshopTransport } from '../../src/routes/atelier/runtime/workshop-transport';
it('pauses the wire and replaces it on resume, forwarding frames and status exactly once', () => {
	const frameListeners = new Set<(frame: Uint8Array) => void>();
	const statusListeners = new Set<(status: TransportStatus) => void>();
	const send = vi.fn();
	const wire: CollaborationTransport = {
		send,
		close: vi.fn(),
		status: () => TransportStatus.Connecting,
		subscribeToFrames: (listener) => {
			frameListeners.add(listener);
			return () => frameListeners.delete(listener);
		},
		subscribeToStatus: (listener) => {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
	};
	const factory = vi.fn(() => wire);
	const transport = new WorkshopTransport(factory);
	const frames = vi.fn();
	const statuses = vi.fn();
	const unframe = transport.subscribeToFrames(frames);
	const unstatus = transport.subscribeToStatus(statuses);
	expect(transport.status()).toBe(TransportStatus.Connecting);
	transport.resume();
	expect(factory).toHaveBeenCalledTimes(1);
	const frame = new Uint8Array([1, 2]);
	transport.send(frame);
	expect(send).toHaveBeenCalledWith(frame);
	for (const listener of frameListeners) listener(frame);
	for (const listener of statusListeners) listener(TransportStatus.Connected);
	expect(frames).toHaveBeenCalledWith(frame);
	expect(statuses).toHaveBeenLastCalledWith(TransportStatus.Connected);
	transport.pause();
	expect(transport.status()).toBe(TransportStatus.Disconnected);
	expect(frameListeners.size).toBe(0);
	expect(statusListeners.size).toBe(0);
	transport.send(frame);
	expect(send).toHaveBeenCalledTimes(1);
	transport.resume();
	expect(factory).toHaveBeenCalledTimes(2);
	expect(statuses).toHaveBeenLastCalledWith(TransportStatus.Connecting);
	unframe();
	unstatus();
	transport.close();
	transport.close();
	expect(transport.status()).toBe(TransportStatus.Disconnected);
	transport.resume();
	expect(factory).toHaveBeenCalledTimes(2);
});
