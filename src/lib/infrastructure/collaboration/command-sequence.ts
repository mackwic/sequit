import { wireId, wireInteger } from './wire-values';

/** One identity per open client session; commands are consecutive within that identity. */
export interface CommandSequence {
	readonly sessionId: string;
	readonly sequence: number;
}

export function readCommandSequence(value: Record<string, unknown>): CommandSequence {
	const sessionId = wireId(value['sessionId']);
	const sequence = wireInteger(value['sequence']);
	if (sequence === 0) throw new Error('Command sequence must be positive');
	return { sessionId, sequence };
}
