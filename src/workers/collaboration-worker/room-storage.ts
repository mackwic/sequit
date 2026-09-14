import * as Y from 'yjs';

import type { CommandSequence } from '../../lib/infrastructure/collaboration/command-sequence';
import { compactRoomDocument } from '../../lib/infrastructure/collaboration/compact-room-document';
import { MAX_PROPOSAL_ID_BYTES } from '../../lib/infrastructure/collaboration/protocol';
import {
	chunkKeys,
	concatChunks,
	type DocumentMeta,
	MAX_ACCEPTED_PROPOSALS,
	MAX_CHUNKS,
	META_KEY,
	type PersistencePlan,
	planPersistence,
} from '../../lib/infrastructure/collaboration/room-persistence';
import {
	RetryableSessionFailure,
	SessionFailureCode,
} from '../../lib/infrastructure/collaboration/session-failure';
import { upgradeSharedTexts } from '../../lib/infrastructure/collaboration/upgrade-shared-texts';
import { readLogicDocument } from '../../lib/infrastructure/collaboration/yjs-document-codec';
import { commandReceiptKey } from './command-receipts';

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
	const doc = new Y.Doc({ gc: false });
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
	const restored = decodeStoredRoomState(meta, storedChunks, roomId);
	const beforeCompaction = Y.encodeStateAsUpdate(restored.doc).byteLength;
	compactRoomDocument(restored.doc);
	const compacted = Y.encodeStateAsUpdate(restored.doc).byteLength < beforeCompaction;
	const upgraded = upgradeSharedTexts(restored.doc);
	if (!upgraded && !compacted) return restored;
	compactRoomDocument(restored.doc);
	try {
		const plan = planPersistence({
			fullUpdate: Y.encodeStateAsUpdate(restored.doc),
			commit: restored.commit + 1,
			currentChunkCount: restored.chunkCount,
			acceptedProposals: restored.acceptedProposals,
		});
		await persistRoomState(storage, plan);
		return { ...restored, commit: plan.meta.commit, chunkCount: plan.chunks.length };
	} catch (error) {
		restored.doc.destroy();
		throw error;
	}
}

export async function persistRoomState(
	storage: DurableObjectStorage,
	plan: PersistencePlan,
	command?: CommandSequence,
): Promise<void> {
	const entries: Record<string, DocumentMeta | Uint8Array | number> = { [META_KEY]: plan.meta };
	if (command !== undefined) entries[commandReceiptKey(command.sessionId)] = command.sequence;
	const keys = chunkKeys(plan.chunks.length);
	for (const [index, chunk] of plan.chunks.entries()) {
		const key = keys[index];
		/* istanbul ignore else -- persistence plans always pair every chunk with a key */
		if (key !== undefined) entries[key] = chunk;
	}
	try {
		await storage.transaction(async (transaction) => {
			await transaction.put(entries);
			if (plan.staleChunkKeys.length > 0) {
				await transaction.delete([...plan.staleChunkKeys]);
			}
		});
	} catch {
		throw new RetryableSessionFailure(
			SessionFailureCode.StorageUnavailable,
			'Le service est temporairement indisponible. Nouvelle tentative en cours.',
		);
	}
}
