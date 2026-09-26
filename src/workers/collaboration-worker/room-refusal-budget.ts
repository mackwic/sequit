import {
	RetryableSessionFailure,
	SessionFailureCode,
	TerminalSessionFailure,
} from '../../lib/infrastructure/collaboration/session-failure';

const MAX_PROPOSAL_REFUSALS = 6;
const MAX_SESSION_REFUSALS = 24;

interface RefusalBudget {
	readonly total: number;
	readonly proposals: Readonly<Record<string, number>>;
}

function storageUnavailable(): RetryableSessionFailure {
	return new RetryableSessionFailure(
		SessionFailureCode.StorageUnavailable,
		'Le service est temporairement indisponible. Nouvelle tentative en cours.',
	);
}

/** Stored per session, not per socket; unrelated proposal IDs cannot reset either limit. */
export async function allowSessionRefusal(
	storage: DurableObjectStorage,
	sessionId: string,
	id: string,
): Promise<boolean> {
	const key = `refusal-session:${sessionId}`;
	let previous: RefusalBudget | undefined;
	try {
		previous = await storage.get<RefusalBudget>(key);
	} catch {
		throw storageUnavailable();
	}
	const total = previous?.total ?? 0;
	let count = 0;
	if (previous !== undefined && Object.hasOwn(previous.proposals, id)) {
		const stored = previous.proposals[id];
		if (stored === undefined)
			throw new TerminalSessionFailure(
				SessionFailureCode.InvalidDocument,
				'Le budget de refus persisté est invalide.',
			);
		count = stored;
	}
	if (!Number.isSafeInteger(total) || !Number.isSafeInteger(count))
		throw new TerminalSessionFailure(
			SessionFailureCode.InvalidDocument,
			'Le budget de refus persisté est invalide.',
		);
	if (total >= MAX_SESSION_REFUSALS || count >= MAX_PROPOSAL_REFUSALS) return false;
	const proposals = { ...previous?.proposals, [id]: count + 1 };
	try {
		await storage.put(key, { total: total + 1, proposals } satisfies RefusalBudget);
	} catch {
		throw storageUnavailable();
	}
	return true;
}
