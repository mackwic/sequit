const PARTICIPANT_NAME_KEY = 'sequit:participant-name';
export const PARTICIPANT_NAME_LIMIT = 40;

export function normalizeParticipantName(value: string): string {
	return value.trim().replaceAll(/\s+/g, ' ').slice(0, PARTICIPANT_NAME_LIMIT);
}

/** The name last used in a session on this browser, or an empty string. */
export function readParticipantName(): string {
	try {
		return normalizeParticipantName(localStorage.getItem(PARTICIPANT_NAME_KEY) ?? '');
	} catch {
		return '';
	}
}

/** Best effort: a browser refusing storage only forgets the name for next time. */
export function writeParticipantName(name: string): void {
	try {
		localStorage.setItem(PARTICIPANT_NAME_KEY, normalizeParticipantName(name));
	} catch {
		// The session keeps the name in memory.
	}
}
