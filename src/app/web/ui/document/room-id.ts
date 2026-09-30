const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 20;
const ROOM_ID = /^[a-z0-9][a-z0-9-]{3,63}$/;

/** A random room identifier, unguessable enough to act as the sharing secret. */
export function newRoomId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
	return [...bytes].map((byte) => ALPHABET.charAt(byte % ALPHABET.length)).join('');
}

/** Room identifiers are also document identifiers and URL segments: keep them plain. */
export function isRoomId(value: string): boolean {
	return ROOM_ID.test(value);
}
