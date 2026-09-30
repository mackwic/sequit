/* eslint-disable no-console -- `console` is the Workers Logs sink; this module is its only writer. */
/**
 * One structured line per room event, readable in Workers Logs and in `wrangler dev`.
 *
 * The room identifier is the sharing secret, so the journal names a room by the first twelve hex
 * characters of its SHA-256; `printf '%s' "$room" | shasum -a 256 | cut -c1-12` correlates.
 */
export interface RoomJournal {
	info(event: string, fields?: Readonly<Record<string, unknown>>): void;
	warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
	error(event: string, error: unknown, fields?: Readonly<Record<string, unknown>>): void;
}

const LABEL_HEX = 12;

export async function roomLabel(roomId: string | undefined): Promise<string> {
	if (roomId === undefined) return 'anonymous';
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(roomId));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, LABEL_HEX);
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function roomJournal(label: string): RoomJournal {
	const line = (event: string, fields?: Readonly<Record<string, unknown>>) => ({
		event: `room.${event}`,
		room: label,
		...fields,
	});
	return {
		info(event, fields): void {
			console.info(line(event, fields));
		},
		warn(event, fields): void {
			console.warn(line(event, fields));
		},
		error(event, error, fields): void {
			console.error(line(event, { ...fields, error: describeError(error) }));
		},
	};
}
