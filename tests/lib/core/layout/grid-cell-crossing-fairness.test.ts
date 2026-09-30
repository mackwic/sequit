import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	crossingBusY,
	crossingIncidence,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing';
import {
	canonicalCrossingAllocation,
	containmentCrossingAllocation,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import type { GridCrossingAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
import { crossingAllocationPhases } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { gridCrossingResources } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-resources';
import {
	crossingPortalSpans,
	crossingRoute,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-routing';
import { searchGridCrossingAllocations } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-search';
import { entersInterior } from '../../../../src/lib/core/layout/grids/grid-cell-geometry-primitives';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grids/grid-cell-types';
import type { Bounds, LayoutRelation } from '../../../../src/lib/core/layout/layout-types';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { nxmThreeByTwoDocument } from './grid-cell-fixture';

function hits(route: LayoutRelation, obstacle: Bounds): boolean {
	for (let index = 1; index < route.points.length; index += 1)
		if (entersInterior(defined(route.points[index - 1]), defined(route.points[index]), obstacle))
			return true;
	return false;
}

function chargedGrid(pairs: readonly (readonly [number, number])[]) {
	const ids = Array.from({ length: 12 }, (_, index) => `n${index}`);
	const template = nxmThreeByTwoDocument();
	const crossing = pairs.map(([from, to], index) => ({
		id: `r${index}`,
		from: `n${from}`,
		to: `n${to}`,
	}));
	const document = {
		...template,
		nodes: ids.map((id, index) => ({
			...defined(template.nodes[0]),
			id,
			markdown: `${id}
`,
			layoutOrder: orderKey(`a${String.fromCharCode(65 + index)}`),
		})),
		relations: crossing,
	};
	const input = {
		rootId: '@root',
		cells: ids.map((id, index) => ({
			id,
			parentId: '@root',
			row: Math.floor(index / 4),
			column: index % 4,
		})),
		cellByEndpointId: new Map(ids.map((id) => [id, id])),
		minimumColumnWidths: [180, 180, 180, 180],
		minimumRowHeights: [90, 90, 90],
	};
	const prepared = prepareLayoutDocument(document);
	const placed = solveGridCellLayout(prepared.graph, prepared.measurements, input);
	if (placed.status !== GridCellLayoutStatus.Selected) throw new Error(placed.reason);
	const resources = gridCrossingResources(input, crossing);
	const incidence = crossingIncidence(crossing);
	const routing = {
		rootId: input.rootId,
		crossing,
		columnCount: 4,
		cells: placed.cells,
		cellByEndpointId: input.cellByEndpointId,
		edges: resources.edges,
		incidence,
	};
	const base = {
		edges: resources.edges,
		crossingIds: crossing.map(({ id }) => id),
		busRelevantRelationIds: crossing.map(({ id }) => id),
		gutterIds: resources.gutterIds,
		rowGutterIds: resources.rowGutterIds,
		incidence,
		portalByRelationId: new Map(),
	};
	const allocationInput = {
		...base,
		portalByRelationId: crossingPortalSpans(routing, canonicalCrossingAllocation(base)),
	};
	return { placed, resources, routing, crossing, allocationInput };
}

function twelveCrossings(): [number, number][] {
	const pairs: [number, number][] = [];
	for (let source = 0; source < 4; source += 1)
		for (let target = 0; target < 4; target += 1)
			if (source !== target) pairs.push([source, target + 8]);
	return pairs;
}

function blockedGap(upper: Bounds, lower: Bounds, x: number): Bounds {
	return {
		x,
		y: upper.y + upper.height + 8,
		width: 8,
		height: lower.y - upper.y - upper.height - 16,
	};
}

function obstacleProbe(
	routing: ReturnType<typeof chargedGrid>['routing'],
	relation: ReturnType<typeof chargedGrid>['crossing'][number],
	obstacles: readonly Bounds[],
) {
	return (allocation: GridCrossingAllocation) => {
		const route = crossingRoute(routing, allocation, relation).route;
		if (obstacles.some((bounds) => hits(route, bounds)))
			return {
				candidate: allocation,
				failure: regionGeometryDiagnostic(
					RegionGeometryDiagnosticCode.GridCrossingEntersElement,
					'The charged route intersects a declared obstacle.',
					{ relationId: relation.id, endpointId: 'declared-obstacle' },
				),
			};
		return { candidate: allocation };
	};
}

describe('bounded grid crossing phases', () => {
	it('finds a second row separation among eight charged 4×3 crossings in the first phase', () => {
		const pairs = [
			[0, 10],
			[1, 11],
			[2, 8],
			[3, 9],
			[0, 11],
			[1, 10],
			[0, 9],
			[2, 11],
		] as const;
		const { placed, resources, routing, crossing, allocationInput } = chargedGrid(pairs);
		expect(resources.rowGutterIds.map((ids) => ids.length)).toEqual([8, 8]);
		const upper = defined(placed.cells.find((cell) => cell.row === 0 && cell.column === 2));
		const middle = defined(placed.cells.find((cell) => cell.row === 1 && cell.column === 2));
		const x = upper.bounds.x + upper.bounds.width / 2;
		const obstacles = [
			blockedGap(upper.bounds, middle.bounds, x),
			{ x, y: 0, width: 8, height: upper.bounds.y - 8 },
		];
		const result = searchGridCrossingAllocations(
			allocationInput,
			obstacleProbe(routing, defined(crossing[7]), obstacles),
			{ rowGutter: 256, reallocate: 1, extraTrack: 1, bridge: 1 },
		);
		if (!('selected' in result)) throw new Error(result.failure.message);
		expect(result.witness.winningPhase).toBe('row-gutter');
		expect(result.witness.phases[0]?.exploredGeometries).toBeLessThan(256);
		expect(result.selected.allocation.rowTrackByRelationId?.[1]?.has('r7')).toBe(true);
		expect(result.witness.phases[1]?.attempted).toBe(false);
	});

	it('exhausts 256 row choices before a fresh bus budget resolves twelve two-gap demands', () => {
		const { placed, resources, routing, crossing, allocationInput } =
			chargedGrid(twelveCrossings());
		expect(resources.rowGutterIds.map((ids) => ids.length)).toEqual([12, 12]);
		const cells = placed.cells.filter((cell) => cell.column === 2);
		const upper = defined(cells.find((cell) => cell.row === 0));
		const middle = defined(cells.find((cell) => cell.row === 1));
		const lower = defined(cells.find((cell) => cell.row === 2));
		const x = upper.bounds.x + upper.bounds.width / 2;
		const obstacles = [
			blockedGap(upper.bounds, middle.bounds, x),
			blockedGap(middle.bounds, lower.bounds, x),
			{ x, y: crossingBusY(resources.edges.topBus, 11) - 4, width: 8, height: 8 },
		];
		const result = searchGridCrossingAllocations(
			allocationInput,
			obstacleProbe(routing, defined(crossing[11]), obstacles),
			{ rowGutter: 256, reallocate: 256, extraTrack: 1, bridge: 1 },
		);
		if (!('selected' in result)) throw new Error(result.failure.message);
		expect(result.witness.phases[0]).toMatchObject({
			id: 'row-gutter',
			exploredGeometries: 256,
			truncated: true,
			selected: false,
		});
		expect(result.witness.winningPhase).toBe('reallocate');
		expect(result.witness.phases[1]?.exploredGeometries).toBeLessThan(256);
		expect(result.selected.allocation.rowTrackByRelationId?.length).toBe(0);
		expect(result.selected.allocation.busTrackByRelationId.get('r11')).not.toBe(11);
	});
	it('visits the earliest relation’s second gap before exhausting the Cartesian tail', () => {
		const { placed, resources, routing, crossing, allocationInput } =
			chargedGrid(twelveCrossings());
		expect(resources.rowGutterIds.map((ids) => ids.length)).toEqual([12, 12]);
		const upper = defined(placed.cells.find((cell) => cell.row === 0 && cell.column === 0));
		const right = defined(placed.cells.find((cell) => cell.row === 0 && cell.column === 1));
		const middle = defined(placed.cells.find((cell) => cell.row === 1 && cell.column === 0));
		const x = (upper.bounds.x + upper.bounds.width + right.bounds.x) / 2;
		const obstacles = [
			blockedGap(upper.bounds, middle.bounds, x),
			{ x, y: crossingBusY(resources.edges.topBus, 0) - 4, width: 8, height: 8 },
		];
		const result = searchGridCrossingAllocations(
			allocationInput,
			obstacleProbe(routing, defined(crossing[0]), obstacles),
			{ rowGutter: 256, reallocate: 1, extraTrack: 1, bridge: 1 },
		);
		if (!('selected' in result)) throw new Error(result.failure.message);
		expect(result.witness.winningPhase).toBe('row-gutter');
		expect(result.witness.phases[0]?.exploredGeometries).toBeLessThan(256);
		expect(result.selected.allocation.rowTrackByRelationId?.[1]?.has('r0')).toBe(true);
	});

	it('keeps the canonical bus even when interval containment proposes a different bus order', () => {
		const { allocationInput } = chargedGrid(twelveCrossings());
		const limited = { ...allocationInput, rowGutterIds: [['r0']] };
		const canonical = canonicalCrossingAllocation(limited);
		const containment = containmentCrossingAllocation(limited);
		expect(containment.busTrackByRelationId).not.toEqual(canonical.busTrackByRelationId);
		const rowPhase = defined(crossingAllocationPhases(limited)[0]);
		const prefix = [...rowPhase.candidates().take(8)];
		expect(prefix).toContainEqual({
			...containment,
			busTrackByRelationId: canonical.busTrackByRelationId,
		});
		for (const candidate of prefix)
			expect(candidate.busTrackByRelationId).toEqual(canonical.busTrackByRelationId);
	});
});
