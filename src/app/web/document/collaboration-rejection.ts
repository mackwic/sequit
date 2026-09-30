const ERROR_KEY = 'sequit:collaboration-error';

/** A terminal rejection reloads the page; the message survives the reload for one display. */
export function refreshRejectedSession(message: string): void {
	try {
		sessionStorage.setItem(ERROR_KEY, message);
	} catch {
		// Without storage the page still recovers; only the explanation is lost.
	}
	window.location.reload();
}

export function consumeCollaborationError(): string | undefined {
	try {
		const message = sessionStorage.getItem(ERROR_KEY);
		if (message === null) return undefined;
		sessionStorage.removeItem(ERROR_KEY);
		return message;
	} catch {
		return undefined;
	}
}
