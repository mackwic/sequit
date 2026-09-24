import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	crossingBusY,
	crossingPortEdge,
	crossingPortPositions,
	crossingPortY,
	crossingRailX,
	gridMargin,
	gridRoutingEdges,
	reservedRailTrack,
} from '../../../../src/lib/core/layout/grid-cell-crossing';
import {
	canonicalCrossingAllocation,
	containmentCrossingAllocation,
	CROSSING_ALLOCATION_BUDGET,
	crossingAllocationCandidates,
	crossingAllocationCandidatesWithExtraTrack,
	type CrossingAllocationInput,
	type GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grid-cell-crossing-allocation';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';

const CROSSING_IDS = ['a-b', 'a-c', 'a-d'] as const;

function allocationInput(): CrossingAllocationInput {
	return {
		edges: gridRoutingEdges('grid', CROSSING_IDS.length),
		crossingIds: [...CROSSING_IDS],
		leftRailIds: ['a-b', 'a-c'],
		rightRailIds: ['a-b', 'a-d'],
		incidence: new Map([
			['a', [...CROSSING_IDS]],
			['b', ['a-b']],
			['c', ['a-c']],
			['d', ['a-d']],
		]),
		portalByRelationId: new Map([
			['a-b', { source: { x: 100, y: 300 }, target: { x: 900, y: 260 } }],
			['a-c', { source: { x: 100, y: 300 }, target: { x: 200, y: 500 } }],
			['a-d', { source: { x: 100, y: 300 }, target: { x: 900, y: 500 } }],
		]),
	};
}

function railTracks(
	allocation: GridCrossingAllocation,
	side: 'leftRailTrackByRelationId' | 'rightRailTrackByRelationId',
): readonly (readonly [string, number])[] {
	return [...allocation[side]].sort(([left], [right]) => compareCanonicalStrings(left, right));
}

describe('grid crossing allocation', () => {
	it('keeps the declared track formulas', () => {
		const edges = gridRoutingEdges('grid', 3);
		expect(edges.leftRail).toEqual({ ownerId: 'grid', capacity: 4, spacing: 24 });
		expect(edges.topBus).toEqual({ ownerId: 'grid', capacity: 3, spacing: 24 });
		expect(reservedRailTrack(edges)).toBe(3);
		expect(
			[0, 1, 2].map((track) => crossingRailX(edges.leftRail, 96, RegionPortalSide.Left, track)),
		).toEqual([48, 24, 0]);
		expect(
			[0, 1, 2].map((track) => crossingRailX(edges.leftRail, 1704, RegionPortalSide.Right, track)),
		).toEqual([1752, 1776, 1800]);
		expect([0, 1, 2].map((track) => crossingBusY(edges.topBus, track))).toEqual([24, 48, 72]);
		expect([0, 1, 2].map((count) => gridMargin(gridRoutingEdges('grid', count)))).toEqual([
			96, 96, 120,
		]);
	});

	it('centres the declared port tracks on the face', () => {
		const face = { x: 0, y: 100, width: 200, height: 60 };
		expect(crossingPortPositions('grid', face, 1)).toEqual([130]);
		expect(crossingPortPositions('grid', face, 2)).toEqual([118, 142]);
		expect(crossingPortPositions('grid', face, 3)).toEqual([106, 130, 154]);
		expect(crossingPortY(face, crossingPortEdge('grid', 1), 0)).toBe(130);
		expect(crossingPortY(face, crossingPortEdge('grid', 2), 1)).toBe(142);
	});

	it('starts with the canonical allocation and its crossing order per rail', () => {
		const input = allocationInput();
		const canonical = canonicalCrossingAllocation(input);
		expect(railTracks(canonical, 'leftRailTrackByRelationId')).toEqual([
			['a-b', 0],
			['a-c', 1],
		]);
		expect(railTracks(canonical, 'rightRailTrackByRelationId')).toEqual([
			['a-b', 0],
			['a-d', 2],
		]);
		expect([...canonical.busTrackByRelationId]).toEqual([
			['a-b', 0],
			['a-c', 1],
			['a-d', 2],
		]);
		expect(defined(canonical.portTrackByEndpointId.get('a'))).toEqual(
			new Map([
				['a-b', 0],
				['a-c', 1],
				['a-d', 2],
			]),
		);
	});

	it('orders the containment candidate by interval inclusion', () => {
		const input = allocationInput();
		const containment = containmentCrossingAllocation(input);
		expect(railTracks(containment, 'leftRailTrackByRelationId')).toEqual([
			['a-b', 0],
			['a-c', 1],
		]);
		expect(railTracks(containment, 'rightRailTrackByRelationId')).toEqual([
			['a-b', 0],
			['a-d', 1],
		]);
		expect([...containment.busTrackByRelationId]).toEqual([
			['a-b', 0],
			['a-c', 1],
			['a-d', 2],
		]);
	});

	it('declares its candidates in order, without repeating an allocation', () => {
		const input = allocationInput();
		const candidates = [...crossingAllocationCandidates(input)];
		expect(candidates[0]).toEqual(canonicalCrossingAllocation(input));
		expect(candidates[1]).toEqual(containmentCrossingAllocation(input));
		const keys = candidates.map((allocation) =>
			JSON.stringify([
				railTracks(allocation, 'leftRailTrackByRelationId'),
				railTracks(allocation, 'rightRailTrackByRelationId'),
				[...allocation.busTrackByRelationId],
				[...allocation.portTrackByEndpointId].map(([endpointId, tracks]) => [
					endpointId,
					[...tracks],
				]),
			]),
		);
		expect(new Set(keys).size).toBe(keys.length);
		expect(candidates.length).toBeLessThanOrEqual(CROSSING_ALLOCATION_BUDGET);
		for (const allocation of candidates) {
			const left = [...allocation.leftRailTrackByRelationId.values()];
			expect(new Set(left).size).toBe(left.length);
			expect(Math.max(...left)).toBeLessThanOrEqual(input.edges.leftRail.capacity - 1);
			const portTracks = [...defined(allocation.portTrackByEndpointId.get('a')).values()].sort(
				(first, second) => first - second,
			);
			expect(portTracks).toEqual([0, 1, 2]);
		}
	});

	it('adds one rail track when the reallocation is exhausted', () => {
		const input = allocationInput();
		const reserved = input.edges.leftRail.capacity - 1;
		const candidates = [...crossingAllocationCandidatesWithExtraTrack(input)];
		expect(candidates.length).toBeGreaterThan(0);
		const tracks = candidates.flatMap((allocation) => [
			...allocation.leftRailTrackByRelationId.values(),
			...allocation.rightRailTrackByRelationId.values(),
		]);
		expect(Math.max(...tracks)).toBe(reserved);
		for (const allocation of candidates) {
			const left = [...allocation.leftRailTrackByRelationId.values()];
			expect(new Set(left).size).toBe(left.length);
			expect(Math.max(...left)).toBeLessThanOrEqual(reserved);
		}
	});

	it('is deterministic across calls', () => {
		const first = [...crossingAllocationCandidates(allocationInput())];
		const second = [...crossingAllocationCandidates(allocationInput())];
		expect(second).toEqual(first);
	});
});
