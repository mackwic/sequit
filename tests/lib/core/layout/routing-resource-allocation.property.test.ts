import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	allocateNestedTracks,
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
});
