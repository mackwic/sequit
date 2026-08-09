import { describe, expect, it } from 'vitest';

import {
	CHUNK_BYTES,
	CHUNK_KEY_PREFIX,
	chunkKeys,
	concatChunks,
	MAX_ACCEPTED_PROPOSALS,
	MAX_CHUNKS,
	planPersistence,
	splitChunks,
} from '../../src/lib/collaboration/room-persistence';

function bytes(length: number): Uint8Array {
	return Uint8Array.from({ length }, (_, index) => index % 251);
}

describe('room persistence planning', () => {
	it('split and concat round-trip at boundary sizes (empty, one byte, exactly one chunk, at the ceiling)', () => {
		for (const length of [0, 1, CHUNK_BYTES, CHUNK_BYTES * MAX_CHUNKS]) {
			const update = bytes(length);
			expect(concatChunks(splitChunks(update))).toEqual(update);
		}
		expect(() => splitChunks(bytes(CHUNK_BYTES * MAX_CHUNKS + 1))).toThrow(RangeError);
	});

	it('a missing chunk makes concat throw', () => {
		expect(() => concatChunks([new Uint8Array([1]), undefined])).toThrow(
			'Stored document chunk is missing',
		);
	});

	it('chunk keys are stable and ordered', () => {
		expect(chunkKeys(3)).toEqual([
			`${CHUNK_KEY_PREFIX}0`,
			`${CHUNK_KEY_PREFIX}1`,
			`${CHUNK_KEY_PREFIX}2`,
		]);
		expect(() => chunkKeys(-1)).toThrow(RangeError);
		expect(() => chunkKeys(MAX_CHUNKS + 1)).toThrow(RangeError);
	});

	it('planning leaves its inputs untouched', () => {
		const fullUpdate = new Uint8Array([1, 2, 3]);
		const acceptedProposals = new Map([['proposal', 1]]);
		const plan = planPersistence({
			fullUpdate,
			commit: 1,
			currentChunkCount: 2,
			acceptedProposals,
		});

		plan.chunks[0]?.fill(9);
		expect(fullUpdate).toEqual(new Uint8Array([1, 2, 3]));
		expect(acceptedProposals).toEqual(new Map([['proposal', 1]]));
		expect(plan.meta).toEqual({
			commit: 1,
			chunkCount: 1,
			acceptedProposals: { proposal: 1 },
		});
	});

	it('the idempotency map is bounded to 128 entries', () => {
		const acceptedProposals = new Map<string, number>();
		for (let commit = 1; commit <= MAX_ACCEPTED_PROPOSALS + 1; commit += 1) {
			acceptedProposals.set(`proposal-${commit}`, commit);
		}
		const plan = planPersistence({
			fullUpdate: new Uint8Array(),
			commit: MAX_ACCEPTED_PROPOSALS + 1,
			currentChunkCount: 0,
			acceptedProposals,
		});

		expect(plan.acceptedProposals).toHaveLength(MAX_ACCEPTED_PROPOSALS);
	});

	it('eviction removes the lowest commit first', () => {
		const acceptedProposals = new Map<string, number>();
		for (let commit = 1; commit <= MAX_ACCEPTED_PROPOSALS; commit += 1) {
			acceptedProposals.set(`proposal-${commit}`, commit);
		}
		acceptedProposals.set('newest', MAX_ACCEPTED_PROPOSALS + 1);
		const plan = planPersistence({
			fullUpdate: new Uint8Array(),
			commit: MAX_ACCEPTED_PROPOSALS + 1,
			currentChunkCount: 0,
			acceptedProposals,
		});

		expect(plan.acceptedProposals.has('proposal-1')).toBe(false);
		expect(plan.acceptedProposals.get('newest')).toBe(MAX_ACCEPTED_PROPOSALS + 1);
	});

	it('a shrinking document lists its stale chunk keys for deletion', () => {
		const plan = planPersistence({
			fullUpdate: bytes(CHUNK_BYTES),
			commit: 2,
			currentChunkCount: 3,
			acceptedProposals: new Map(),
		});

		expect(plan.staleChunkKeys).toEqual([`${CHUNK_KEY_PREFIX}1`, `${CHUNK_KEY_PREFIX}2`]);
	});
});
