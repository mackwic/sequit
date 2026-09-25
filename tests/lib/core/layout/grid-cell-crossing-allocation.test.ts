import fc from 'fast-check';
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
	crossingAllocationGeometryCount,
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
} from '../../../../src/lib/core/layout/grid-cell-crossing-phases';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

const CROSSING_IDS = ['a-b', 'a-c', 'a-d'] as const;

function allocationInput(): CrossingAllocationInput {
	return {
		edges: gridRoutingEdges('grid', 2, CROSSING_IDS.length),
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

function variedAllocationInput(
	crossingCount: number,
	columnCount: number,
	seed: number,
): CrossingAllocationInput {
	const crossingIds = Array.from({ length: crossingCount }, (_, index) => `route-${index}`);
	const incidence = new Map<string, string[]>();
	for (const [index, relationId] of crossingIds.entries()) {
		for (const endpointId of [`source-${(index + seed) % 2}`, `target-${index % 2}`]) {
			const relations = incidence.get(endpointId) ?? [];
			relations.push(relationId);
			incidence.set(endpointId, relations);
		}
	}
	return {
		edges: gridRoutingEdges('property-grid', columnCount, crossingCount),
		crossingIds,
		busRelevantRelationIds: crossingIds.filter((_, index) => (index + seed) % 2 === 0),
		gutterIds: Array.from({ length: columnCount }, (_, column) =>
			crossingIds.filter((_, index) => (index + column + seed) % 2 === 0),
		),
		incidence,
		portalByRelationId: new Map(
			crossingIds.map((relationId, index) => [
				relationId,
				{
					source: { x: 100 + index * 20, y: 100 + ((index + seed) % crossingCount) * 30 },
					target: { x: 700 - index * 20, y: 300 + ((index + seed) % crossingCount) * 30 },
				},
			]),
		),
	};
}

function geometryKey(input: CrossingAllocationInput, allocation: GridCrossingAllocation): string {
	const entries = (tracks: ReadonlyMap<string, number>) =>
		[...tracks].sort(([left], [right]) => compareCanonicalStrings(left, right));
	const busRelevant = new Set(input.busRelevantRelationIds);
	return JSON.stringify([
		allocation.gutterTrackByRelationId.map(entries),
		entries(
			new Map(
				[...allocation.busTrackByRelationId].filter(([relationId]) => busRelevant.has(relationId)),
			),
		),
		[...allocation.portTrackByEndpointId]
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
			.map(([endpointId, tracks]) => [endpointId, entries(tracks)]),
	]);
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

	it('deduplicates bus permutations that cannot change same-rail routes', () => {
		const sharedRail = { ...allocationInput(), busRelevantRelationIds: [] };
		const allRails = { ...sharedRail, busRelevantRelationIds: [...CROSSING_IDS] };
		const sharedRailCandidates = [...crossingAllocationCandidates(sharedRail)];
		const allRailCandidates = [...crossingAllocationCandidates(allRails)];
		expect(BigInt(sharedRailCandidates.length)).toBe(crossingAllocationGeometryCount(sharedRail));
		expect(sharedRailCandidates.length).toBeLessThan(allRailCandidates.length);
		expect(
			new Set(sharedRailCandidates.map((allocation) => geometryKey(sharedRail, allocation))).size,
		).toBe(sharedRailCandidates.length);
	});

	it('declares its candidates in order, without repeating an allocation', () => {
		const input = allocationInput();
		const candidates = [...crossingAllocationCandidates(input)];
		expect(BigInt(candidates.length)).toBe(crossingAllocationGeometryCount(input));
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
		expect([...defined(phases[2]).candidates(input)]).toEqual([
			...crossingAllocationCandidates(input),
		]);
		for (const phase of phases) {
			const candidates = [...phase.candidates(input)];
			expect(candidates.length).toBeGreaterThan(0);
			expect(BigInt(candidates.length)).toBe(phase.totalGeometries(input));
		}
	});

	it('counts unique route geometries over varied small allocation spaces', () => {
		fc.assert(
			fc.property(
				fc.record({
					crossingCount: fc.integer({ min: 1, max: 3 }),
					columnCount: fc.integer({ min: 1, max: 2 }),
					seed: fc.integer({ min: 0, max: 5 }),
				}),
				({ crossingCount, columnCount, seed }) => {
					const input = variedAllocationInput(crossingCount, columnCount, seed);
					const phases = crossingAllocationPhases(input);
					const reallocation = [...defined(phases[0]).candidates(input)];
					const extraTrack = [...defined(phases[1]).candidates(input)];
					const bridge = [...defined(phases[2]).candidates(input)];
					expect(reallocation[0]).toEqual(canonicalCrossingAllocation(input));
					for (const [phaseIndex, candidates] of [reallocation, extraTrack, bridge].entries()) {
						const phase = defined(phases[phaseIndex]);
						const keys = candidates.map((allocation) => geometryKey(input, allocation));
						expect(new Set(keys).size).toBe(candidates.length);
						expect(BigInt(candidates.length)).toBe(phase.totalGeometries(input));
					}
					const oldGeometry = new Set(
						reallocation.map((allocation) => geometryKey(input, allocation)),
					);
					expect(
						extraTrack.every((allocation) => !oldGeometry.has(geometryKey(input, allocation))),
					).toBe(true);
					for (const allocation of extraTrack)
						expect(
							allocation.gutterTrackByRelationId.some((tracks, column) =>
								[...tracks.values()].includes(defined(input.edges.gutters[column]).capacity - 1),
							),
						).toBe(true);
					expect(bridge).toEqual(reallocation);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('is deterministic across calls', () => {
		const first = [...crossingAllocationCandidates(allocationInput())];
		const second = [...crossingAllocationCandidates(allocationInput())];
		expect(second).toEqual(first);
	});
});
