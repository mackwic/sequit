import { MAX_PROPOSAL_ID_BYTES } from './protocol';

export const META_KEY = 'document-meta';
export const CHUNK_KEY_PREFIX = 'document-chunk:';
export const CHUNK_BYTES = 64 * 1024;
export const MAX_CHUNKS = 15;
export const MAX_ACCEPTED_PROPOSALS = 128;

export interface DocumentMeta {
	readonly commit: number;
	readonly chunkCount: number;
	readonly acceptedProposals: Readonly<Record<string, number>>;
}

export interface PersistenceInput {
	readonly fullUpdate: Uint8Array;
	readonly commit: number;
	readonly currentChunkCount: number;
	readonly acceptedProposals: ReadonlyMap<string, number>;
}

export interface PersistencePlan {
	readonly meta: DocumentMeta;
	readonly chunks: readonly Uint8Array[];
	readonly staleChunkKeys: readonly string[];
	readonly acceptedProposals: ReadonlyMap<string, number>;
}

export function chunkKeys(count: number): readonly string[] {
	const outsideBounds = count < 0 || count > MAX_CHUNKS;
	if (!Number.isSafeInteger(count) || outsideBounds) {
		throw new RangeError(`Chunk count must be between 0 and ${MAX_CHUNKS}`);
	}
	return Array.from({ length: count }, (_, index) => `${CHUNK_KEY_PREFIX}${index}`);
}

export function splitChunks(bytes: Uint8Array): readonly Uint8Array[] {
	if (bytes.byteLength > CHUNK_BYTES * MAX_CHUNKS) {
		throw new RangeError('Document exceeds the persistable size limit');
	}
	const chunks: Uint8Array[] = [];
	for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
		chunks.push(bytes.slice(offset, offset + CHUNK_BYTES));
	}
	return chunks;
}

export function concatChunks(parts: readonly (Uint8Array | undefined)[]): Uint8Array {
	let byteLength = 0;
	for (const part of parts) {
		if (part === undefined) throw new Error('Stored document chunk is missing');
		byteLength += part.byteLength;
	}
	const result = new Uint8Array(byteLength);
	let offset = 0;
	for (const part of parts) {
		if (part === undefined) throw new Error('Stored document chunk is missing');
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function boundedAcceptedProposals(
	acceptedProposals: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
	for (const [id, commit] of acceptedProposals) {
		const idByteLength = new TextEncoder().encode(id).byteLength;
		if (idByteLength === 0 || idByteLength > MAX_PROPOSAL_ID_BYTES) {
			throw new RangeError('Accepted proposal id is outside protocol bounds');
		}
		if (!Number.isSafeInteger(commit) || commit <= 0) {
			throw new RangeError('Accepted proposal commit must be a positive safe integer');
		}
	}
	const ordered = [...acceptedProposals].sort(([leftId, leftCommit], [rightId, rightCommit]) => {
		const commitOrder = rightCommit - leftCommit;
		if (commitOrder !== 0) return commitOrder;
		return leftId.localeCompare(rightId);
	});
	return new Map(ordered.slice(0, MAX_ACCEPTED_PROPOSALS));
}

export function planPersistence(input: PersistenceInput): PersistencePlan {
	if (!Number.isSafeInteger(input.commit) || input.commit <= 0) {
		throw new RangeError('Document commit must be a positive safe integer');
	}
	const chunks = splitChunks(input.fullUpdate);
	const acceptedProposals = boundedAcceptedProposals(input.acceptedProposals);
	if ([...acceptedProposals.values()].some((acceptedCommit) => acceptedCommit > input.commit)) {
		throw new RangeError('Accepted proposal commit cannot exceed document commit');
	}
	const meta: DocumentMeta = {
		commit: input.commit,
		chunkCount: chunks.length,
		acceptedProposals: Object.fromEntries(acceptedProposals),
	};
	return {
		meta,
		chunks,
		staleChunkKeys: chunkKeys(input.currentChunkCount).slice(chunks.length),
		acceptedProposals,
	};
}
