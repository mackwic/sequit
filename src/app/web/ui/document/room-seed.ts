const PREFIX = 'sequit:room-seed:';

/**
 * Hands the document that starts a room over to the session page through `sessionStorage`, so
 * the initial content never travels in the URL and a reload does not re-propose it.
 */
export function stashRoomSeed(room: string, source: string): void {
	sessionStorage.setItem(`${PREFIX}${room}`, source);
}

export function takeRoomSeed(room: string): string | undefined {
	try {
		const key = `${PREFIX}${room}`;
		const source = sessionStorage.getItem(key);
		if (source === null) return undefined;
		sessionStorage.removeItem(key);
		return source;
	} catch {
		return undefined;
	}
}
