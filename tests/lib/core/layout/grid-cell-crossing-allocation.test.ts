import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	crossingBusY,
	crossingFaceEdge,
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
	crossingAllocationCandidates,
	crossingAllocationCandidatesWithExtraTrack,
	type CrossingAllocationInput,
	type GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grid-cell-crossing-allocation';
import {
	crossingAllocationCandidateCount,
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
	GRID_CROSSING_BRIDGE_BUDGET,
	GRID_CROSSING_EXTRA_TRACK_BUDGET,
	GRID_CROSSING_REALLOCATION_BUDGET,
} from '../../../../src/lib/core/layout/grid-cell-crossing-phases';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';

const CROSSING_IDS = ['a-b', 'a-c', 'a-d'] as const;

function allocationInput(): CrossingAllocationInput {
	return {
		edges: gridRoutingEdges('grid', 2, CROSSING_IDS.length),
		crossingIds: [...CROSSING_IDS],
		gutterIds: [
			['a-b', 'a-c'],
			['a-b', 'a-d'],
		],
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

function gutterTracks(
	allocation: GridCrossingAllocation,
	column: number,
): readonly (readonly [string, number])[] {
	return [...defined(allocation.gutterTrackByRelationId[column])].sort(([left], [right]) =>
		compareCanonicalStrings(left, right),
	);
}

function busOrder(allocation: GridCrossingAllocation): readonly string[] {
	return [...allocation.busTrackByRelationId]
		.sort(([, left], [, right]) => left - right)
		.map(([relationId]) => relationId);
}

describe('grid crossing allocation', () => {
	it('keeps the declared track formulas', () => {
		const edges = gridRoutingEdges('grid', 2, 3);
		expect(edges.gutters[0]).toEqual({ ownerId: 'grid', capacity: 4, spacing: 24 });
		expect(edges.gutters[1]).toEqual({ ownerId: 'grid', capacity: 4, spacing: 24 });
		expect(edges.topBus).toEqual({ ownerId: 'grid', capacity: 3, spacing: 24 });
		expect(reservedRailTrack(defined(edges.gutters[0]))).toBe(3);
		expect(
			[0, 1, 2].map((track) =>
				crossingRailX(defined(edges.gutters[0]), 96, RegionPortalSide.Left, track),
			),
		).toEqual([48, 24, 0]);
		expect(
			[0, 1, 2].map((track) =>
				crossingRailX(defined(edges.gutters[1]), 1704, RegionPortalSide.Right, track),
			),
		).toEqual([1752, 1776, 1800]);
		expect([0, 1, 2].map((track) => crossingBusY(edges.topBus, track))).toEqual([24, 48, 72]);
		expect([0, 1, 2].map((count) => gridMargin(gridRoutingEdges('grid', 2, count)))).toEqual([
			96, 96, 120,
		]);
	});

	it('centres the declared port tracks on the face', () => {
		const face = { x: 0, y: 100, width: 200, height: 60 };
		expect(crossingPortPositions('grid', face, 1)).toEqual([130]);
		expect(crossingPortPositions('grid', face, 2)).toEqual([118, 142]);
		expect(crossingPortPositions('grid', face, 3)).toEqual([106, 130, 154]);
		expect(crossingPortY(face, crossingFaceEdge('grid', 1), 0)).toBe(130);
		expect(crossingPortY(face, crossingFaceEdge('grid', 2), 1)).toBe(142);
	});

	it('starts with the canonical allocation and its crossing order per gutter', () => {
		const input = allocationInput();
		const canonical = canonicalCrossingAllocation(input);
		expect(gutterTracks(canonical, 0)).toEqual([
			['a-b', 0],
			['a-c', 1],
		]);
		expect(gutterTracks(canonical, 1)).toEqual([
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
		expect(gutterTracks(containment, 0)).toEqual([
			['a-b', 0],
			['a-c', 1],
		]);
		expect(gutterTracks(containment, 1)).toEqual([
			['a-b', 0],
			['a-d', 1],
		]);
		expect([...containment.busTrackByRelationId]).toEqual([
			['a-b', 0],
			['a-c', 1],
			['a-d', 2],
		]);
	});

	it('keeps the canonical bus order first, then explores every distinct bus order', () => {
		const input = allocationInput();
		const candidates = [...crossingAllocationCandidates(input)];
		const orders = candidates.map(busOrder);

		expect(orders[0]).toEqual([...CROSSING_IDS]);
		expect(new Set(orders.map((order) => JSON.stringify(order))).size).toBe(6);
		expect(orders).toContainEqual(['a-c', 'a-b', 'a-d']);
	});

	it('declares its candidates in order, without repeating an allocation', () => {
		const input = allocationInput();
		const candidates = [...crossingAllocationCandidates(input)];
		expect(BigInt(candidates.length)).toBe(crossingAllocationCandidateCount(input));
		expect(candidates[0]).toEqual(canonicalCrossingAllocation(input));
		expect(candidates[1]).toEqual(containmentCrossingAllocation(input));
		const keys = candidates.map((allocation) =>
			JSON.stringify([
				allocation.gutterTrackByRelationId.map((tracks) => [...tracks]),
				[...allocation.busTrackByRelationId],
				[...allocation.portTrackByEndpointId].map(([endpointId, tracks]) => [
					endpointId,
					[...tracks],
				]),
			]),
		);
		expect(new Set(keys).size).toBe(keys.length);
		expect(candidates.length).toBeGreaterThan(GRID_CROSSING_REALLOCATION_BUDGET);
		for (const allocation of candidates) {
			const left = [...defined(allocation.gutterTrackByRelationId[0]).values()];
			expect(new Set(left).size).toBe(left.length);
			expect(Math.max(...left)).toBeLessThanOrEqual(defined(input.edges.gutters[0]).capacity - 1);
			const portTracks = [...defined(allocation.portTrackByEndpointId.get('a')).values()].sort(
				(first, second) => first - second,
			);
			expect(portTracks).toEqual([0, 1, 2]);
		}
	});

	it('adds one gutter track when the reallocation is exhausted', () => {
		const input = allocationInput();
		const reserved = defined(input.edges.gutters[0]).capacity - 1;
		const candidates = [...crossingAllocationCandidatesWithExtraTrack(input)];
		expect(candidates.length).toBeGreaterThan(0);
		const tracks = candidates.flatMap((allocation) => [
			...defined(allocation.gutterTrackByRelationId[0]).values(),
			...defined(allocation.gutterTrackByRelationId[1]).values(),
		]);
		expect(Math.max(...tracks)).toBe(reserved);
		for (const allocation of candidates) {
			const left = [...defined(allocation.gutterTrackByRelationId[0]).values()];
			expect(new Set(left).size).toBe(left.length);
			expect(Math.max(...left)).toBeLessThanOrEqual(reserved);
		}
	});

	it('declares the reallocation, extra-track and bridge issues in that order', () => {
		const input = allocationInput();
		const phases = crossingAllocationPhases(input);
		expect(phases.map(({ id }) => id)).toEqual([
			CrossingAllocationPhaseId.Reallocate,
			CrossingAllocationPhaseId.ExtraTrack,
			CrossingAllocationPhaseId.Bridge,
		]);
		expect(phases.map(({ acceptBridges }) => acceptBridges)).toEqual([false, false, true]);
		expect(phases.map(({ budget }) => budget)).toEqual([
			GRID_CROSSING_REALLOCATION_BUDGET,
			GRID_CROSSING_EXTRA_TRACK_BUDGET,
			GRID_CROSSING_BRIDGE_BUDGET,
		]);
		expect([...defined(phases[2]).candidates(input)]).toEqual([
			...crossingAllocationCandidates(input),
		]);
		for (const phase of phases) {
			const candidates = [...phase.candidates(input)];
			expect(candidates.length).toBeGreaterThan(0);
			expect(BigInt(candidates.length)).toBe(phase.total(input));
		}
	});

	it('is deterministic across calls', () => {
		const first = [...crossingAllocationCandidates(allocationInput())];
		const second = [...crossingAllocationCandidates(allocationInput())];
		expect(second).toEqual(first);
	});
});
