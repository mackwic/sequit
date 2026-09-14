import type { CommandSequence } from '../../lib/infrastructure/collaboration/command-sequence';
import {
	RetryableSessionFailure,
	SessionFailureCode,
} from '../../lib/infrastructure/collaboration/session-failure';

/** Durable per-session high-water marks are never evicted while the document exists. */
export function commandReceiptKey(sessionId: string): string {
	return `command-session:${sessionId}`;
}

export async function readCommandReceipt(
	storage: DurableObjectStorage,
	command: CommandSequence,
): Promise<number> {
	try {
		const value: unknown = await storage.get(commandReceiptKey(command.sessionId));
		if (value === undefined) return 0;
		if (typeof value !== 'number') throw new Error('Stored command receipt is invalid');
		if (!Number.isSafeInteger(value) || value <= 0)
			throw new Error('Stored command receipt is invalid');
		return value;
	} catch {
		throw new RetryableSessionFailure(
			SessionFailureCode.StorageUnavailable,
			'Le service est temporairement indisponible. Nouvelle tentative en cours.',
		);
	}
}
