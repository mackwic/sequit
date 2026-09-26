import * as Y from 'yjs';

const TEXT_DEBOUNCE_MS = 50;
const TEXT_MAX_WAIT_MS = 500;

/** Buffers only local text updates. Reconnection can recover unsent edits from the Y.Doc. */
export class TextUpdateBuffer {
	readonly #updates: Uint8Array[] = [];
	#debounce: ReturnType<typeof setTimeout> | undefined;
	#deadline: ReturnType<typeof setTimeout> | undefined;
	#closed = false;

	constructor(private readonly send: (update: Uint8Array) => void) {}

	push(update: Uint8Array): void {
		if (this.#closed) return;
		this.#updates.push(update.slice());
		if (this.#debounce !== undefined) clearTimeout(this.#debounce);
		this.#debounce = setTimeout(() => {
			this.flush();
		}, TEXT_DEBOUNCE_MS);
		this.#deadline ??= setTimeout(() => {
			this.flush();
		}, TEXT_MAX_WAIT_MS);
	}

	hasPending(): boolean {
		return this.#updates.length > 0;
	}

	flush(): void {
		this.#clearTimers();
		if (this.#updates.length === 0) return;
		const update = Y.mergeUpdates(this.#updates);
		this.#updates.length = 0;
		this.send(update);
	}

	/** A terminal rejection must discard the pending batch rather than send on unload. */
	close(): void {
		this.#closed = true;
		this.#clearTimers();
		this.#updates.length = 0;
	}

	#clearTimers(): void {
		if (this.#debounce !== undefined) clearTimeout(this.#debounce);
		if (this.#deadline !== undefined) clearTimeout(this.#deadline);
		this.#debounce = undefined;
		this.#deadline = undefined;
	}
}
