export const SOCKET_HANDSHAKE_TIMEOUT_MS = 10_000;
export const SOCKET_HEARTBEAT_INTERVAL_MS = 15_000;
export const SOCKET_HEARTBEAT_TIMEOUT_MS = 10_000;

/** A silent open socket must not indefinitely masquerade as a live connection. */
export class SocketHealth {
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly ping: () => void,
		private readonly lost: () => void,
	) {
		this.#timer = setTimeout(lost, SOCKET_HANDSHAKE_TIMEOUT_MS);
	}

	received(): void {
		this.close();
		this.#timer = setTimeout(() => {
			this.#timer = setTimeout(this.lost, SOCKET_HEARTBEAT_TIMEOUT_MS);
			this.ping();
		}, SOCKET_HEARTBEAT_INTERVAL_MS);
	}

	close(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
	}
}
