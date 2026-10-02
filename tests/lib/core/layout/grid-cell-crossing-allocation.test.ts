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
	CrossingPortal,
	GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
import {
	crossingAllocationGeometryCount,
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { routedPortAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-port-order';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	effectiveRouteGeometry,
	variedGridRoutingCase,
} from './grid-cell-crossing-allocation-fixture';

const CROSSING_IDS = ['a-b', 'a-c', 'a-d'] as const;

function portal(
	endpointId: string,
	row: number,
	column: number,
	x: number,
	y: number,
): CrossingPortal {
	return { endpointId, row, column, point: { x, y } };
}

/** a and c share the first column; b and d the second. */
function allocationInput(): CrossingAllocationInput {
	const gutterIds = [
		['a-b', 'a-c', 'a-d'],
		['a-b', 'a-d'],
	];
	return {
		edges: gridRoutingEdges('grid', gutterIds, CROSSING_IDS.length),
		crossingIds: [...CROSSING_IDS],
		busRelevantRelationIds: ['a-b', 'a-d'],
		gutterIds,
		incidence: new Map([
			['a', [...CROSSING_IDS]],
			['b', ['a-b']],
			['c', ['a-c']],
			['d', ['a-d']],
		]),
		portalByRelationId: new Map([
			['a-b', { source: portal('a', 0, 0, 100, 300), target: portal('b', 0, 1, 900, 260) }],
			['a-c', { source: portal('a', 0, 0, 100, 300), target: portal('c', 1, 0, 200, 500) }],
			['a-d', { source: portal('a', 0, 0, 100, 300), target: portal('d', 1, 1, 900, 500) }],
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
			busRelevantRelationIds: ['a-b', 'a-c'],
			incidence: new Map(),
			portalByRelationId: new Map([
				['a-b', { source: portal('a', 0, 0, 100, 200), target: portal('b', 0, 1, 300, 200) }],
				['a-c', { source: portal('a', 0, 0, 100, 200), target: portal('c', 0, 2, 500, 200) }],
				['c-f', { source: portal('c', 0, 2, 500, 200), target: portal('f', 1, 2, 500, 400) }],
			]),
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

	it('saturates every phase without recursing through many adjacent-row relations', () => {
		const ids = Array.from({ length: 15_000 }, (_, index) => `cross-${index}`);
		const rows = [
			ids.filter((_, index) => index % 2 === 0),
			ids.filter((_, index) => index % 2 === 1),
		];
		const input: CrossingAllocationInput = {
			...allocationInput(),
			edges: gridRoutingEdges('grid', [], ids.length),
			crossingIds: ids,
			busRelevantRelationIds: ids,
			gutterIds: [],
			rowGutterIds: rows,
			incidence: new Map([['origin', ids]]),
		};
		const phases = crossingAllocationPhases(input);
		for (const phase of phases) {
			if (phase.id === CrossingAllocationPhaseId.ExtraTrack)
				expect(phase.totalGeometries()).toBe(0n);
			else expect(phase.totalGeometries()).toBe(BigInt(phase.budget + 1));
		}
	});

	it('starts with the canonical allocation and its crossing order per gutter', () => {
		const input = allocationInput();
		const canonical = canonicalCrossingAllocation(input);
		expect(gutterTracks(canonical, 0)).toEqual([
			['a-b', 0],
			['a-c', 1],
			['a-d', 2],
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
			['a-d', 2],
		]);
		expect(gutterTracks(containment, 1)).toEqual([
			['a-b', 0],
			['a-d', 1],
		]);
		// The inner rail interval must take the bus track nearest the grid (larger ordinal).
		expect(defined(containment.busTrackByRelationId.get('a-b'))).toBeGreaterThan(
			defined(containment.busTrackByRelationId.get('a-d')),
		);
	});

	it('orders each face by its routed runs: upward inner tracks highest, downward ones lowest', () => {
		const input = allocationInput();
		const canonical = canonicalCrossingAllocation(input);
		const outerSameColumn = {
			...canonical,
			gutterTrackByRelationId: [
				new Map([
					['a-d', 0],
					['a-b', 1],
					['a-c', 2],
				]),
				defined(canonical.gutterTrackByRelationId[1]),
			],
		};
		// Over the bus, a-d and a-b climb from a (inner first); a-c runs down to c below.
		expect(
			defined(routedPortAllocation(input, outerSameColumn).portTrackByEndpointId.get('a')),
		).toEqual(
			new Map([
				['a-d', 0],
				['a-b', 1],
				['a-c', 2],
			]),
		);
		// On the row boundary below a, a-d runs down too, inside a-c: the outer run leaves above it.
		const rowRouted = { ...outerSameColumn, rowTrackByRelationId: [new Map([['a-d', 0]])] };
		const routed = routedPortAllocation(input, rowRouted);
		expect([...defined(routed.portTrackByEndpointId.get('a'))]).toEqual([
			['a-b', 0],
			['a-c', 1],
			['a-d', 2],
		]);
		expect(defined(routed.portTrackByEndpointId.get('d'))).toEqual(new Map([['a-d', 0]]));
		// A conflict-first prefix moves only its active relations, on the ports they hold: a-c
		// keeps its middle port, a-d and a-b swap the outer two.
		const prefix = routedPortAllocation(input, outerSameColumn, new Set(['a-b', 'a-d']));
		expect(defined(prefix.portTrackByEndpointId.get('a'))).toEqual(
			new Map([
				['a-b', 2],
				['a-c', 1],
				['a-d', 0],
			]),
		);
	});

	it('nests the first bus order consistently with its rails, then explores every distinct order', () => {
		const input = allocationInput();
		const candidates = [...crossingAllocationCandidates(input)];
		const orders = candidates.map(busOrder);

		const first = defined(candidates[0]);
		expect(defined(first.busTrackByRelationId.get('a-b'))).toBeGreaterThan(
			defined(first.busTrackByRelationId.get('a-d')),
		);
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

	it('declares row gutters, bus reallocation, extra track and bridge in order', () => {
		const input = allocationInput();
		const phases = crossingAllocationPhases(input);
		expect(phases.map(({ id }) => id)).toEqual([
			CrossingAllocationPhaseId.RowGutter,
			CrossingAllocationPhaseId.Reallocate,
			CrossingAllocationPhaseId.ExtraTrack,
			CrossingAllocationPhaseId.Bridge,
		]);
		expect(phases.map(({ acceptBridges }) => acceptBridges)).toEqual([false, false, false, true]);
		expect([...defined(phases[3]).candidates()]).toEqual([...crossingAllocationCandidates(input)]);
		for (const phase of phases) {
			const candidates = [...phase.candidates()];
			expect(candidates.length).toBeGreaterThan(0);
			expect(phase.totalGeometries()).toBe(BigInt(Math.min(candidates.length, phase.budget + 1)));
		}
	});

	it('is deterministic across calls', () => {
		const first = [...crossingAllocationCandidates(allocationInput())];
		const second = [...crossingAllocationCandidates(allocationInput())];
		expect(second).toEqual(first);
	});
});
