import * as Y from 'yjs';

import { MAX_PROPOSAL_ID_BYTES } from '../../../src/lib/collaboration/protocol';
import {
	chunkKeys,
	concatChunks,
	type DocumentMeta,
	MAX_ACCEPTED_PROPOSALS,
	MAX_CHUNKS,
	META_KEY,
	type PersistencePlan,
} from '../../../src/lib/collaboration/room-persistence';
import { readLogicDocument } from '../../../src/lib/collaboration/yjs-document-codec';

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

function isAcceptedProposals(
	value: unknown,
	commit: number,
): value is Readonly<Record<string, number>> {
	if (typeof value !== 'object') return false;
	if (value === null || Array.isArray(value)) return false;
	const entries = Object.entries(value);
	if (entries.length > MAX_ACCEPTED_PROPOSALS) return false;
	return entries.every(([id, acceptedCommit]) => {
		const idBytes = new TextEncoder().encode(id).byteLength;
		if (idBytes === 0 || idBytes > MAX_PROPOSAL_ID_BYTES) return false;
		if (!isNonNegativeSafeInteger(acceptedCommit)) return false;
		return acceptedCommit > 0 && acceptedCommit <= commit;
	});
}

function isDocumentMeta(value: unknown): value is DocumentMeta {
	if (typeof value !== 'object') return false;
	if (value === null || Array.isArray(value)) return false;
	if (!('commit' in value)) return false;
	if (!isNonNegativeSafeInteger(value.commit)) return false;
	if (!('chunkCount' in value)) return false;
	if (!isNonNegativeSafeInteger(value.chunkCount)) return false;
	if (value.chunkCount > MAX_CHUNKS) return false;
	if ((value.commit === 0) !== (value.chunkCount === 0)) return false;
	if (!('acceptedProposals' in value)) return false;
	return isAcceptedProposals(value.acceptedProposals, value.commit);
}

export function parseDocumentMeta(value: unknown): DocumentMeta {
	if (!isDocumentMeta(value)) throw new Error('Stored document metadata is invalid');
	return value;
}

function storedChunk(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) return value;
	return undefined;
}

export function decodeStoredRoomState(
	meta: DocumentMeta,
	storedChunks: ReadonlyMap<string, unknown>,
	roomId: string | undefined,
): RoomState {
	const keys = [...chunkKeys(meta.chunkCount)];
	const fullUpdate = concatChunks(keys.map((key) => storedChunk(storedChunks.get(key))));
	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, fullUpdate);
		const document = readLogicDocument(doc);
		if (!document.ok) throw new Error('Stored document is invalid');
		if (document.value.id !== roomId) throw new Error('Stored document id does not match room');
	} catch (error) {
		doc.destroy();
		throw new Error('Stored document update is invalid', { cause: error });
	}
	return {
		doc,
		commit: meta.commit,
		chunkCount: meta.chunkCount,
		acceptedProposals: new Map(Object.entries(meta.acceptedProposals)),
	};
}

export async function restoreRoomState(
	storage: DurableObjectStorage,
	emptyState: RoomState,
	roomId: string | undefined,
): Promise<RoomState> {
	let storedMeta: unknown;
	try {
		storedMeta = await storage.get(META_KEY);
	} catch (error) {
		emptyState.doc.destroy();
		throw error;
	}
	if (storedMeta === undefined) return emptyState;
	emptyState.doc.destroy();
	const meta = parseDocumentMeta(storedMeta);

	const keys = [...chunkKeys(meta.chunkCount)];
	const storedChunks = await storage.get(keys);
	return decodeStoredRoomState(meta, storedChunks, roomId);
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
