import * as Y from 'yjs';

import {
	chunkKeys,
	concatChunks,
	type DocumentMeta,
	MAX_CHUNKS,
	META_KEY,
	type PersistencePlan,
} from '../../../src/lib/collaboration/room-persistence';

export interface RoomState {
	readonly doc: Y.Doc;
	readonly commit: number;
	readonly chunkCount: number;
	readonly acceptedProposals: ReadonlyMap<string, number>;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	if (typeof value !== 'number') return false;
	return Number.isSafeInteger(value) && value >= 0;
}

function isAcceptedProposals(value: unknown): value is Readonly<Record<string, number>> {
	if (typeof value !== 'object') return false;
	if (value === null || Array.isArray(value)) return false;
	return Object.values(value).every(isNonNegativeSafeInteger);
}

function isDocumentMeta(value: unknown): value is DocumentMeta {
	if (typeof value !== 'object') return false;
	if (value === null || Array.isArray(value)) return false;
	if (!('commit' in value)) return false;
	if (!isNonNegativeSafeInteger(value.commit)) return false;
	if (!('chunkCount' in value)) return false;
	if (!isNonNegativeSafeInteger(value.chunkCount)) return false;
	if (value.chunkCount > MAX_CHUNKS) return false;
	if (!('acceptedProposals' in value)) return false;
	return isAcceptedProposals(value.acceptedProposals);
}

function storedChunk(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) return value;
	return undefined;
}

export async function restoreRoomState(
	storage: DurableObjectStorage,
	emptyState: RoomState,
): Promise<RoomState> {
	const storedMeta = await storage.get(META_KEY);
	if (storedMeta === undefined) return emptyState;
	if (!isDocumentMeta(storedMeta)) throw new Error('Stored document metadata is invalid');

	const keys = [...chunkKeys(storedMeta.chunkCount)];
	const storedChunks = await storage.get(keys);
	const fullUpdate = concatChunks(keys.map((key) => storedChunk(storedChunks.get(key))));
	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, fullUpdate);
	} catch (error) {
		doc.destroy();
		throw new Error('Stored document update is invalid', { cause: error });
	}
	return {
		doc,
		commit: storedMeta.commit,
		chunkCount: storedMeta.chunkCount,
		acceptedProposals: new Map(Object.entries(storedMeta.acceptedProposals)),
	};
}

export async function persistRoomState(
	storage: DurableObjectStorage,
	plan: PersistencePlan,
): Promise<void> {
	const entries: Record<string, DocumentMeta | Uint8Array> = { [META_KEY]: plan.meta };
	const keys = chunkKeys(plan.chunks.length);
	for (const [index, chunk] of plan.chunks.entries()) {
		const key = keys[index];
		/* istanbul ignore else -- persistence plans always pair every chunk with a key */
		if (key !== undefined) entries[key] = chunk;
	}
	await storage.transaction(async (transaction) => {
		await transaction.put(entries);
		if (plan.staleChunkKeys.length > 0) {
			await transaction.delete([...plan.staleChunkKeys]);
		}
	});
}
