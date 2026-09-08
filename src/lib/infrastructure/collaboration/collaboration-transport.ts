export enum TransportStatus {
	Connecting = 'connecting',
	Connected = 'connected',
	Disconnected = 'disconnected',
}

export interface CollaborationTransport {
	send(frame: Uint8Array): void;
	subscribeToFrames(listener: (frame: Uint8Array) => void): () => void;
	subscribeToStatus(listener: (status: TransportStatus) => void): () => void;
	status(): TransportStatus;
	close(): void;
}
