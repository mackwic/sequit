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
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing';
import {
	canonicalCrossingAllocation,
	containmentCrossingAllocation,
	crossingAllocationCandidates,
	crossingAllocationCandidatesWithExtraTrack,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
import {
	crossingAllocationGeometryCount,
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	effectiveRouteGeometry,
	variedGridRoutingCase,
} from './grid-cell-crossing-allocation-fixture';

const CROSSING_IDS = ['a-b', 'a-c', 'a-d'] as const;

function allocationInput(): CrossingAllocationInput {
	return {
		edges: gridRoutingEdges(
			'grid',
			[
				['a-b', 'a-c'],
				['a-b', 'a-d'],
			],
			CROSSING_IDS.length,
		),
		crossingIds: [...CROSSING_IDS],
		busRelevantRelationIds: [...CROSSING_IDS],
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
		const edges = gridRoutingEdges(
			'grid',
			[
				['a-b', 'a-c'],
				['a-b', 'a-d'],
			],
			3,
		);
		expect(edges.gutters[0]).toEqual({ ownerId: 'grid', capacity: 3, spacing: 24 });
		expect(edges.gutters[1]).toEqual({ ownerId: 'grid', capacity: 3, spacing: 24 });
		expect(edges.topBus).toEqual({ ownerId: 'grid', capacity: 3, spacing: 24 });
		expect(reservedRailTrack(defined(edges.gutters[0]))).toBe(2);
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
		expect(
			[0, 1, 2].map((count) =>
				gridMargin(
					gridRoutingEdges(
						'grid',
						[Array.from({ length: count }, (_, index) => String(index))],
						count,
					),
				),
			),
		).toEqual([96, 96, 120]);
	});

	it('uses independent capacities for empty, shared-column and asymmetric gutters', () => {
		const ids = ['a-b', 'a-c', 'c-f'];
		const gutterIds = [['a-b', 'a-c'], ['a-b'], ['a-c', 'c-f'], []];
		const edges = gridRoutingEdges('grid', gutterIds, ids.length);
		expect(edges.gutters.map(({ capacity }) => capacity)).toEqual([3, 2, 3, 1]);
		expect(edges.topBus.capacity).toBe(3);
		const input: CrossingAllocationInput = {
			edges,
			gutterIds,
			crossingIds: ids,
			busRelevantRelationIds: ids,
			incidence: new Map(),
			portalByRelationId: new Map(
				ids.map((id) => [
					id,
					{
						source: { x: 100, y: 200 },
						target: { x: 300, y: 400 },
					},
				]),
			),
		};
		const canonical = canonicalCrossingAllocation(input);
		expect(canonical.gutterTrackByRelationId.map((tracks) => [...tracks])).toEqual([
			[
				['a-b', 0],
				['a-c', 1],
			],
			[['a-b', 0]],
			[
				['a-c', 0],
				['c-f', 1],
			],
			[],
		]);
		const ordinary = [...crossingAllocationCandidates(input)];
		const extra = [...crossingAllocationCandidatesWithExtraTrack(input)];
		expect(BigInt(ordinary.length)).toBe(24n);
		expect(BigInt(ordinary.length)).toBe(crossingAllocationGeometryCount(input));
		expect(BigInt(extra.length)).toBe(120n);
		expect(BigInt(extra.length)).toBe(crossingAllocationGeometryCount(input, 1));
		for (const allocation of ordinary) {
			for (const [column, tracks] of allocation.gutterTrackByRelationId.entries())
				for (const track of tracks.values())
					expect(track).toBeLessThan(defined(edges.gutters[column]).capacity - 1);
		}
		for (const allocation of extra) {
			const expanded = allocation.gutterTrackByRelationId.flatMap((tracks, column) =>
				[...tracks.values()].filter(
					(track) => track === defined(edges.gutters[column]).capacity - 1,
				),
			);
			expect(expanded).toHaveLength(1);
			expect(allocation.gutterTrackByRelationId[3]?.size).toBe(0);
		}
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
			['a-d', 1],
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

	it('deduplicates bus permutations that cannot change same-rail routes', () => {
		const sharedRail = variedGridRoutingCase(3, 2, 0, true);
		const allRails = variedGridRoutingCase(3, 2, 0);
		const sharedRailCandidates = [...crossingAllocationCandidates(sharedRail.input)];
		const allRailCandidates = [...crossingAllocationCandidates(allRails.input)];
		const geometries = sharedRailCandidates.map((allocation) =>
			effectiveRouteGeometry(sharedRail.routing, sharedRail.crossing, allocation),
		);
		expect(BigInt(new Set(geometries).size)).toBe(
			crossingAllocationGeometryCount(sharedRail.input),
		);
		expect(sharedRailCandidates.length).toBeLessThan(allRailCandidates.length);
		expect(new Set(geometries).size).toBe(sharedRailCandidates.length);
	});

	it('declares each actual route geometry once in candidate order', () => {
		const { input, routing, crossing } = variedGridRoutingCase(3, 2, 1);
		const candidates = [...crossingAllocationCandidates(input)];
		expect(BigInt(candidates.length)).toBe(crossingAllocationGeometryCount(input));
		expect(candidates[0]).toEqual(canonicalCrossingAllocation(input));
		const geometries = candidates.map((allocation) =>
			effectiveRouteGeometry(routing, crossing, allocation),
		);
		expect(new Set(geometries).size).toBe(geometries.length);

		for (const allocation of candidates) {
			for (const [column, ids] of input.gutterIds.entries()) {
				const tracks = [...defined(allocation.gutterTrackByRelationId[column]).values()];
				expect(new Set(tracks).size).toBe(ids.length);
				expect(Math.max(...tracks)).toBeLessThanOrEqual(
					defined(input.edges.gutters[column]).capacity - 1,
				);
			}
			for (const [endpointId, ids] of input.incidence) {
				const portTracks = [
					...defined(allocation.portTrackByEndpointId.get(endpointId)).values(),
				].sort((first, second) => first - second);
				expect(portTracks).toEqual(Array.from({ length: ids.length }, (_, track) => track));
			}
		}
	});

	it('adds one gutter track when the reallocation is exhausted', () => {
		const input = allocationInput();
		const reserved = defined(input.edges.gutters[0]).capacity - 1;
		const candidates = [...crossingAllocationCandidatesWithExtraTrack(input)];
		expect(BigInt(candidates.length)).toBe(crossingAllocationGeometryCount(input, 1));
		for (const allocation of candidates) {
			const tracksByGutter = allocation.gutterTrackByRelationId.map((tracks) => [
				...defined(tracks).values(),
			]);
			expect(
				tracksByGutter.filter((tracks, column) =>
					tracks.includes(defined(input.edges.gutters[column]).capacity - 1),
				),
			).toHaveLength(1);
			const left = tracksByGutter[0] ?? [];
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
		expect([...defined(phases[2]).candidates()]).toEqual([...crossingAllocationCandidates(input)]);
		for (const phase of phases) {
			const candidates = [...phase.candidates()];
			expect(candidates.length).toBeGreaterThan(0);
			expect(BigInt(candidates.length)).toBe(phase.totalGeometries());
		}
	});

	it('is deterministic across calls', () => {
		const first = [...crossingAllocationCandidates(allocationInput())];
		const second = [...crossingAllocationCandidates(allocationInput())];
		expect(second).toEqual(first);
	});
});
