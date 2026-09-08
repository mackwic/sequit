import {
	type CollaborationTransport,
	TransportStatus,
} from '../../../lib/infrastructure/collaboration/collaboration-transport';
/** Pausing replaces the socket, not the collaborative session or its pending edits. */
export class WorkshopTransport implements CollaborationTransport {
	private closed = false;
	private current: CollaborationTransport | undefined;
	private stopFrames: (() => void) | undefined;
	private stopStatus: (() => void) | undefined;
	private readonly frames = new Set<(frame: Uint8Array) => void>();
	private readonly statuses = new Set<(status: TransportStatus) => void>();
	constructor(private readonly connect: () => CollaborationTransport) {
		this.resume();
	}
	status(): TransportStatus {
		return this.current?.status() ?? TransportStatus.Disconnected;
	}
	send(frame: Uint8Array): void {
		this.current?.send(frame);
	}
	subscribeToFrames(listener: (frame: Uint8Array) => void): () => void {
		this.frames.add(listener);
		return () => this.frames.delete(listener);
	}
	subscribeToStatus(listener: (status: TransportStatus) => void): () => void {
		this.statuses.add(listener);
		return () => this.statuses.delete(listener);
	}
	pause(): void {
		if (!this.current) return;
		this.stopFrames?.();
		this.stopStatus?.();
		this.current.close();
		this.current = undefined;
		for (const listener of this.statuses) listener(TransportStatus.Disconnected);
	}
	resume(): void {
		if (this.current || this.closed) return;
		this.current = this.connect();
		this.stopFrames = this.current.subscribeToFrames((frame) => {
			for (const listener of this.frames) listener(frame);
		});
		this.stopStatus = this.current.subscribeToStatus((status) => {
			for (const listener of this.statuses) listener(status);
		});
		for (const listener of this.statuses) listener(this.current.status());
	}
	close(): void {
		this.closed = true;
		this.pause();
		this.frames.clear();
		this.statuses.clear();
	}
}
