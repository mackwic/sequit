import {
	type CollaborationTransport,
	TransportStatus,
} from '../../../src/lib/infrastructure/collaboration/collaboration-transport';

export class MemoryTransport implements CollaborationTransport {
	readonly #frameListeners = new Set<(frame: Uint8Array) => void>();
	readonly #statusListeners = new Set<(status: TransportStatus) => void>();
	readonly #pendingFrames: Uint8Array[] = [];
	#peer: MemoryTransport | undefined;
	#status = TransportStatus.Connected;
	#autoDeliver = true;

	connect(peer: MemoryTransport): void {
		this.#peer = peer;
	}

	send(frame: Uint8Array): void {
		if (this.#status !== TransportStatus.Connected) return;
		this.#peer?.receive(frame.slice());
	}

	subscribeToFrames(listener: (frame: Uint8Array) => void): () => void {
		this.#frameListeners.add(listener);
		return () => this.#frameListeners.delete(listener);
	}

	subscribeToStatus(listener: (status: TransportStatus) => void): () => void {
		this.#statusListeners.add(listener);
		return () => this.#statusListeners.delete(listener);
	}

	status(): TransportStatus {
		return this.#status;
	}

	close(): void {
		this.setStatus(TransportStatus.Disconnected);
		this.#frameListeners.clear();
		this.#statusListeners.clear();
	}

	setStatus(status: TransportStatus): void {
		if (this.#status === status) return;
		this.#status = status;
		for (const listener of [...this.#statusListeners]) listener(status);
	}

	setAutoDeliver(autoDeliver: boolean): void {
		this.#autoDeliver = autoDeliver;
		if (autoDeliver) this.deliverAll();
	}

	deliverNext(): Uint8Array | undefined {
		const frame = this.#pendingFrames.shift();
		if (frame === undefined) return undefined;
		for (const listener of [...this.#frameListeners]) listener(frame.slice());
		return frame;
	}

	deliverAll(): void {
		while (this.deliverNext() !== undefined) {
			// Deliver until the queue is empty, including frames produced reentrantly.
		}
	}

	dropNext(): Uint8Array | undefined {
		return this.#pendingFrames.shift();
	}

	duplicateNext(): void {
		const frame = this.#pendingFrames[0];
		if (frame !== undefined) this.#pendingFrames.splice(1, 0, frame.slice());
	}

	pendingFrameCount(): number {
		return this.#pendingFrames.length;
	}

	injectFrame(frame: Uint8Array): void {
		for (const listener of [...this.#frameListeners]) listener(frame.slice());
	}

	private receive(frame: Uint8Array): void {
		if (this.#status === TransportStatus.Disconnected) return;
		this.#pendingFrames.push(frame);
		if (this.#autoDeliver) this.deliverAll();
	}
}

export interface MemoryTransportPair {
	readonly client: MemoryTransport;
	readonly server: MemoryTransport;
}

export function createMemoryTransportPair(): MemoryTransportPair {
	const client = new MemoryTransport();
	const server = new MemoryTransport();
	client.connect(server);
	server.connect(client);
	return { client, server };
}
