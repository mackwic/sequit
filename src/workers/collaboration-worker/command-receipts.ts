import type { CommandSequence } from '../../lib/infrastructure/collaboration/command-sequence';
import {
	RetryableSessionFailure,
	SessionFailureCode,
	TerminalSessionFailure,
} from '../../lib/infrastructure/collaboration/session-failure';

/** Durable per-session high-water marks are never evicted while the document exists. */
export function commandReceiptKey(sessionId: string): string {
	return `command-session:${sessionId}`;
}

export async function readCommandReceipt(
	storage: DurableObjectStorage,
	command: CommandSequence,
): Promise<number> {
	let value: unknown;
	try {
		value = await storage.get(commandReceiptKey(command.sessionId));
	} catch {
		throw new RetryableSessionFailure(
			SessionFailureCode.StorageUnavailable,
			'Le service est temporairement indisponible. Nouvelle tentative en cours.',
		);
	}
	if (value === undefined) return 0;
	if (typeof value !== 'number') throw corruptReceipt(command.sessionId);
	if (!Number.isSafeInteger(value)) throw corruptReceipt(command.sessionId);
	if (value <= 0) throw corruptReceipt(command.sessionId);

	return value;
}

function corruptReceipt(sessionId: string): TerminalSessionFailure {
	return new TerminalSessionFailure(
		SessionFailureCode.CorruptCommandReceipt,
		`Reçu de commande corrompu pour la session ${sessionId}.`,
	);
}
