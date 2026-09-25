import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	defined,
	EndpointKind,
	type LogicRelation,
} from '../../../../src/lib/core/document/logic-document';
import type { TopologicalRanks } from '../../../../src/lib/core/graph/topological-ranks';
import {
	crossingBusY,
	crossingFaceEdge,
	crossingIncidence,
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
import {
	crossingPortalSpans,
	crossingRoute,
	type GridCrossingRouting,
} from '../../../../src/lib/core/layout/grid-cell-crossing-routing';
import { searchGridCrossingAllocations } from '../../../../src/lib/core/layout/grid-cell-crossing-search';
import type { GridCellPlacement } from '../../../../src/lib/core/layout/grid-cell-types';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/region-geometry-diagnostic';
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

interface VariedGridRoutingCase {
	readonly input: CrossingAllocationInput;
	readonly routing: GridCrossingRouting;
	readonly crossing: readonly LogicRelation[];
}

function variedGridRoutingCase(
	crossingCount: number,
	columnCount: number,
	seed: number,
	sameRail = false,
): VariedGridRoutingCase {
	let rowCount = 1 + (seed % 2);
	if (sameRail) rowCount = 2;
	const crossing = Array.from({ length: crossingCount }, (_, index): LogicRelation => {
		let from = `source-${index}`;
		if (seed % 2 === 0) from = 'source-shared';
		return { id: `route-${index}`, from, to: `target-${index}` };
	});
	const cells = Array.from({ length: rowCount * columnCount }, (_, index) => {
		const row = Math.floor(index / columnCount);
		const column = index % columnCount;
		return { id: `cell-${row}-${column}`, row, column };
	});
	const endpointsByCellId = new Map(cells.map(({ id }) => [id, [] as string[]]));
	const cellByEndpointId = new Map<string, string>();
	const assignEndpoint = (endpointId: string, row: number, column: number): void => {
		const cellId = `cell-${row}-${column}`;
		if (cellByEndpointId.has(endpointId)) return;
		cellByEndpointId.set(endpointId, cellId);
		defined(endpointsByCellId.get(cellId)).push(endpointId);
	};
	for (const [index, relation] of crossing.entries()) {
		const sourceRow = seed % rowCount;
		let targetRow = (index + seed + 1) % rowCount;
		if (sameRail) targetRow = (sourceRow + 1) % rowCount;
		let targetColumn = columnCount - 1;
		if (sameRail) targetColumn = 0;
		assignEndpoint(relation.from, sourceRow, 0);
		assignEndpoint(relation.to, targetRow, targetColumn);
	}
	for (const cell of cells) {
		if (defined(endpointsByCellId.get(cell.id)).length === 0) {
			const endpointId = `anchor-${cell.row}-${cell.column}`;
			cellByEndpointId.set(endpointId, cell.id);
			defined(endpointsByCellId.get(cell.id)).push(endpointId);
		}
	}
	const placements: GridCellPlacement[] = cells.map((cell) => {
		const x = 100 + cell.column * 700;
		const y = 100 + cell.row * 400;
		const elements = defined(endpointsByCellId.get(cell.id)).map((id, index) => ({
			id,
			kind: EndpointKind.Node,
			bounds: {
				x: 80 + (index % 3) * 130,
				y: 60 + Math.floor(index / 3) * 90,
				width: 100,
				height: 56,
			},
		}));
		const localLayout: LayoutResult = { width: 520, height: 300, elements, relations: [] };
		const localRanks: TopologicalRanks = { bands: [], byEndpointId: new Map() };
		return {
			...cell,
			parentId: 'property-grid',
			bounds: { x, y, width: 520, height: 300 },
			translation: { x, y },
			localLayout,
			localRanks,
		};
	});
	const cellById = new Map(placements.map((cell) => [cell.id, cell]));
	const edges = gridRoutingEdges('property-grid', columnCount, crossing.length);
	const incidence = crossingIncidence(crossing);
	const routing: GridCrossingRouting = {
		rootId: 'property-grid',
		crossing,
		columnCount,
		cells: placements,
		cellByEndpointId,
		edges,
		incidence,
	};
	const allocationInput: CrossingAllocationInput = {
		edges,
		crossingIds: crossing.map(({ id }) => id),
		busRelevantRelationIds: crossing
			.filter(
				({ from, to }) =>
					defined(cellById.get(defined(cellByEndpointId.get(from)))).column !==
					defined(cellById.get(defined(cellByEndpointId.get(to)))).column,
			)
			.map(({ id }) => id),
		gutterIds: Array.from({ length: columnCount }, (_, column) =>
			crossing
				.filter(({ from, to }) =>
					[from, to].some(
						(endpointId) =>
							defined(cellById.get(defined(cellByEndpointId.get(endpointId)))).column === column,
					),
				)
				.map(({ id }) => id),
		),
		incidence,
		portalByRelationId: new Map(),
	};
	const canonical = canonicalCrossingAllocation(allocationInput);
	return {
		input: {
			...allocationInput,
			portalByRelationId: crossingPortalSpans(routing, canonical),
		},
		routing,
		crossing,
	};
}

function effectiveRouteGeometry(
	routing: GridCrossingRouting,
	crossing: readonly LogicRelation[],
	allocation: GridCrossingAllocation,
): string {
	return JSON.stringify(crossing.map((relation) => crossingRoute(routing, allocation, relation)));
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

	it('keeps synthetic search-contract failures typed when every bounded phase truncates', () => {
		const input = allocationInput();
		let attempted = 0;
		const result = searchGridCrossingAllocations(input, (allocation) => {
			attempted += 1;
			return {
				candidate: allocation,
				failure: regionGeometryDiagnostic(
					RegionGeometryDiagnosticCode.ParentRouteContact,
					`Blocked geometry ${attempted}`,
					{ relationId: 'a-b' },
				),
			};
		});
		if ('selected' in result) throw new Error('Rejected geometries cannot be selected.');
		expect(attempted).toBe(3 * 256);
		expect(result.failure).toMatchObject({
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			message: `Blocked geometry ${attempted}`,
		});
		expect(result.witness.attempted).toBe(attempted);
		expect(result.witness.exhaustive).toBe(false);
		expect(
			result.witness.phases.map(
				({ attempted: phaseAttempted, exploredGeometries, exhaustive, truncated, selected }) => ({
					attempted: phaseAttempted,
					exploredGeometries,
					exhaustive,
					truncated,
					selected,
				}),
			),
		).toEqual(
			Array.from({ length: 3 }, () => ({
				attempted: true,
				exploredGeometries: 256,
				exhaustive: false,
				truncated: true,
				selected: false,
			})),
		);
	});

	it('compares exact cardinality with route points and portals on admissible grids', () => {
		fc.assert(
			fc.property(
				fc.record({
					crossingCount: fc.integer({ min: 1, max: 2 }),
					columnCount: fc.integer({ min: 2, max: 3 }),
					seed: fc.integer({ min: 0, max: 5 }),
					sameRail: fc.boolean(),
				}),
				({ crossingCount, columnCount, seed, sameRail }) => {
					const { input, routing, crossing } = variedGridRoutingCase(
						crossingCount,
						columnCount,
						seed,
						sameRail,
					);
					const phases = crossingAllocationPhases(input);
					const reallocation = [...defined(phases[0]).candidates(input)];
					const extraTrack = [...defined(phases[1]).candidates(input)];
					const bridge = [...defined(phases[2]).candidates(input)];
					expect(reallocation[0]).toEqual(canonicalCrossingAllocation(input));
					for (const [phaseIndex, candidates] of [reallocation, extraTrack, bridge].entries()) {
						const phase = defined(phases[phaseIndex]);
						const geometries = candidates.map((allocation) =>
							effectiveRouteGeometry(routing, crossing, allocation),
						);
						expect(new Set(geometries).size).toBe(candidates.length);
						expect(BigInt(new Set(geometries).size)).toBe(phase.totalGeometries(input));
					}
					const existingGeometry = new Set(
						reallocation.map((allocation) => effectiveRouteGeometry(routing, crossing, allocation)),
					);
					for (const allocation of extraTrack)
						expect(
							existingGeometry.has(effectiveRouteGeometry(routing, crossing, allocation)),
						).toBe(false);
					for (const allocation of extraTrack)
						expect(
							allocation.gutterTrackByRelationId.some((tracks, column) =>
								[...tracks.values()].includes(defined(input.edges.gutters[column]).capacity - 1),
							),
						).toBe(true);
					expect(
						bridge.map((allocation) => effectiveRouteGeometry(routing, crossing, allocation)),
					).toEqual(
						reallocation.map((allocation) => effectiveRouteGeometry(routing, crossing, allocation)),
					);
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
