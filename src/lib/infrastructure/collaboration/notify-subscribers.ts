/** A projection or UI listener cannot terminate synchronization or starve other subscribers. */
export function notifySubscribers<T>(listeners: Iterable<(value: T) => void>, value: T): void {
	for (const listener of [...listeners]) {
		try {
			listener(value);
		} catch (error) {
			if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
		}
	}
}

export function subscribeToSet<T>(
	listeners: Set<(value: T) => void>,
	listener: (value: T) => void,
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
