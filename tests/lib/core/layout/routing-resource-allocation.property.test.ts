import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	allocateCenteredTrack,
	allocateNestedTracks,
	centeredTrackOffset,
	edgeExtent,
	type RoutingEdge,
	type RoutingTrackAllocation,
	type RoutingTrackDemand,
	trackOffset,
} from '../../../../src/lib/core/layout/routing-resource-allocation';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

interface Interval {
	readonly minimum: number;
	readonly maximum: number;
}

interface AllocationCase {
	readonly demands: readonly RoutingTrackDemand[];
	readonly permuted: readonly RoutingTrackDemand[];
}

const intervals = fc
	.tuple(fc.integer({ min: -60, max: 60 }), fc.integer({ min: -60, max: 60 }))
	.map(([left, right]): Interval => ({
		minimum: Math.min(left, right),
		maximum: Math.max(left, right),
	}));

function demandsOf(values: readonly Interval[]): readonly RoutingTrackDemand[] {
	return values.map(({ minimum, maximum }, index) => ({
		relationId: `r-${index}`,
		start: minimum,
		end: maximum,
	}));
}

function edgeFor(capacity: number): RoutingEdge {
	return { ownerId: 'region', capacity, spacing: 20 };
}

/** Declared-rank demands of one edge: identical intervals, so only the ordinal can order them. */
function declaredDemands(ordinals: readonly number[]): readonly RoutingTrackDemand[] {
	return ordinals.map((order, index) => ({
		relationId: `r-${index}`,
		start: 0,
		end: 100,
		order,
	}));
}

/** A free interval a centred edge owns, generated with a strict order and a positive length. */
const freeIntervals = fc
	.tuple(fc.integer({ min: -60, max: 20 }), fc.integer({ min: 1, max: 40 }))
	.map(([start, length]) => ({ start, end: start + length }));

/** A deterministic Fisher–Yates order so a permutation is replayable from its seed. */
function permutation(count: number, seed: number): readonly number[] {
	const order = Array.from({ length: count }, (_, index) => index);
	let state = seed;
	for (let position = count - 1; position > 0; position -= 1) {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		const pick = state % (position + 1);
		const held = defined(order[position]);
		order[position] = defined(order[pick]);
		order[pick] = held;
	}
	return order;
}

function permute(
	values: readonly RoutingTrackDemand[],
	seed: number,
): readonly RoutingTrackDemand[] {
	return permutation(values.length, seed).map((index) => defined(values[index]));
}

function trackOf(allocation: RoutingTrackAllocation, relationId: string): number {
	return defined(allocation.trackByRelationId.get(relationId));
}

function strictlyContains(outer: Interval, inner: Interval): boolean {
	return outer.minimum < inner.minimum && inner.maximum < outer.maximum;
}

const allocationCase = fc
	.tuple(
		fc.array(intervals, { minLength: 0, maxLength: 8 }),
		fc.integer({ min: 0, max: 2_000_000_000 }),
	)
	.map(([values, seed]): AllocationCase => {
		const demands = demandsOf(values);
		return { demands, permuted: permute(demands, seed) };
	});

describe('routing resource allocation', () => {
	it('gives every demand a distinct track inside the edge capacity', () => {
		fc.assert(
			fc.property(fc.array(intervals, { minLength: 0, maxLength: 8 }), (values) => {
				const edge = edgeFor(values.length);
				const allocation = allocateNestedTracks(edge, demandsOf(values));
				expect(allocation.trackByRelationId.size).toBe(values.length);
				const tracks = [...allocation.trackByRelationId.values()];
				expect(new Set(tracks).size).toBe(tracks.length);
				for (const track of tracks) {
					expect(track).toBeGreaterThanOrEqual(0);
					expect(track).toBeLessThan(values.length);
					expect(trackOffset(edge, track)).toBeLessThanOrEqual(edgeExtent(edge));
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('orders a strictly outer interval farther from the children', () => {
		fc.assert(
			fc.property(fc.array(intervals, { minLength: 2, maxLength: 8 }), (values) => {
				const edge = edgeFor(values.length);
				const allocation = allocateNestedTracks(edge, demandsOf(values));
				for (const [outerIndex, outer] of values.entries()) {
					for (const [innerIndex, inner] of values.entries()) {
						if (outerIndex === innerIndex) continue;
						if (!strictlyContains(outer, inner)) continue;
						const outerTrack = trackOf(allocation, `r-${outerIndex}`);
						const innerTrack = trackOf(allocation, `r-${innerIndex}`);
						expect(outerTrack).toBeGreaterThan(innerTrack);
						expect(trackOffset(edge, outerTrack)).toBeGreaterThan(trackOffset(edge, innerTrack));
					}
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('uses canonical order when interval bounds are shared', () => {
		const demands: readonly RoutingTrackDemand[] = [
			{ relationId: 'z-outer', start: 0, end: 100 },
			{ relationId: 'a-shared-start', start: 0, end: 40 },
			{ relationId: 'b-shared-end', start: 60, end: 100 },
			{ relationId: 'c-inner', start: 25, end: 75 },
		];
		const edge = edgeFor(demands.length);
		const allocation = allocateNestedTracks(edge, demands);
		const shuffled = allocateNestedTracks(edge, [...demands].reverse());
		expect(trackOf(allocation, 'a-shared-start')).toBe(0);
		expect(trackOf(allocation, 'b-shared-end')).toBe(1);
		expect(trackOf(allocation, 'c-inner')).toBe(2);
		expect(trackOf(allocation, 'z-outer')).toBe(3);
		for (const { relationId } of demands)
			expect(trackOf(shuffled, relationId)).toBe(trackOf(allocation, relationId));
	});

	it('is invariant under permutation of the demands', () => {
		fc.assert(
			fc.property(allocationCase, ({ demands, permuted }) => {
				const edge = edgeFor(demands.length);
				const allocation = allocateNestedTracks(edge, demands);
				const shuffled = allocateNestedTracks(edge, permuted);
				for (const { relationId } of demands)
					expect(trackOf(shuffled, relationId)).toBe(trackOf(allocation, relationId));
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects more demands than the edge capacity', () => {
		fc.assert(
			fc.property(fc.array(intervals, { minLength: 1, maxLength: 8 }), (values) => {
				const demands = demandsOf(values);
				expect(() => allocateNestedTracks(edgeFor(demands.length - 1), demands)).toThrow(
					/tracks for/,
				);
			}),
			PROPERTY_PARAMETERS,
		);
	});
	it('orders a declared ordinal ahead of the canonical identifier', () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 0, maxLength: 8 }),
				(ordinals) => {
					const allocation = allocateNestedTracks(
						edgeFor(ordinals.length),
						declaredDemands(ordinals),
					);
					for (const [left, leftOrder] of ordinals.entries())
						for (const [right, rightOrder] of ordinals.entries()) {
							if (leftOrder === rightOrder) continue;
							const difference =
								trackOf(allocation, `r-${left}`) - trackOf(allocation, `r-${right}`);
							expect(Math.sign(difference)).toBe(Math.sign(leftOrder - rightOrder));
						}
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps the canonical identifier order for identical intervals without an ordinal', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 8 }), (count) => {
				const demands: readonly RoutingTrackDemand[] = Array.from(
					{ length: count },
					(_value, index) => ({ relationId: `r-${index}`, start: 0, end: 100 }),
				);
				const allocation = allocateNestedTracks(edgeFor(count), demands);
				for (const index of demands.keys()) expect(trackOf(allocation, `r-${index}`)).toBe(index);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('sorts a demand that declares no ordinal after the declared ones', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: 20 })), {
					minLength: 1,
					maxLength: 8,
				}),
				(entries) => {
					const demands: RoutingTrackDemand[] = [];
					const declaredIds: string[] = [];
					const plainIds: string[] = [];
					for (const [index, [declared, order]] of entries.entries()) {
						const relationId = `r-${index}`;
						if (!declared) {
							plainIds.push(relationId);
							demands.push({ relationId, start: 0, end: 10 });
							continue;
						}
						declaredIds.push(relationId);
						demands.push({ relationId, start: 0, end: 10, order });
					}
					const allocation = allocateNestedTracks(edgeFor(demands.length), demands);
					for (const declaredId of declaredIds)
						for (const plainId of plainIds)
							expect(trackOf(allocation, declaredId)).toBeLessThan(trackOf(allocation, plainId));
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps a declared ordinal allocation invariant under permutation', () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 0, maxLength: 8 }),
				fc.integer({ min: 0, max: 2_000_000_000 }),
				(ordinals, seed) => {
					const demands = declaredDemands(ordinals);
					const allocation = allocateNestedTracks(edgeFor(demands.length), demands);
					const shuffled = allocateNestedTracks(edgeFor(demands.length), permute(demands, seed));
					for (const { relationId } of demands)
						expect(trackOf(shuffled, relationId)).toBe(trackOf(allocation, relationId));
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('centres the single track of an interval edge strictly inside its free interval', () => {
		fc.assert(
			fc.property(freeIntervals, ({ start, end }) => {
				const edge: RoutingEdge = { ownerId: 'passage', capacity: 1, spacing: 20 };
				const allocation = allocateCenteredTrack(edge, { relationId: 'passage', start, end });
				expect(allocation.track).toBe(0);
				const coordinate = centeredTrackOffset(allocation);
				expect(coordinate).toBeGreaterThan(start);
				expect(coordinate).toBeLessThan(end);
				const reversed = allocateCenteredTrack(edge, {
					relationId: 'passage',
					start: end,
					end: start,
				});
				expect(centeredTrackOffset(reversed)).toBe(coordinate);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
