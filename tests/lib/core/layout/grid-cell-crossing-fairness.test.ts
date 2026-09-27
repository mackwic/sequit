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
import { canonicalCrossingAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import type { GridCrossingAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
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

describe('fair grid crossing search', () => {
	it('finds a noncanonical bus and second row separation among eight charged 4×3 crossings', () => {
		const ids = Array.from({ length: 12 }, (_, index) => `n${index}`);
		const template = nxmThreeByTwoDocument();
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
				markdown: `${id}\n`,
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
		expect(resources.rowGutterIds.map((ids) => ids.length)).toEqual([8, 8]);
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
		const cell = (row: number, column: number) =>
			defined(placed.cells.find((cell) => cell.row === row && cell.column === column));
		const first = cell(0, 0);
		const middle = cell(1, 0);
		const bottom = cell(2, 0);
		const rowGap = (upper: typeof first, lower: typeof first, x: number): Bounds => ({
			x,
			y: upper.bounds.y + upper.bounds.height + 8,
			width: 8,
			height: lower.bounds.y - upper.bounds.y - upper.bounds.height - 16,
		});
		const x6 = first.bounds.x + first.bounds.width / 2;
		const x7 = cell(0, 2).bounds.x + cell(0, 2).bounds.width / 2;
		const obstacles6 = [
			rowGap(first, middle, x6),
			rowGap(middle, bottom, x6),
			{ x: x6, y: crossingBusY(resources.edges.topBus, 6) - 4, width: 8, height: 8 },
		];
		const obstacles7 = [
			rowGap(cell(0, 2), cell(1, 2), x7),
			{ x: x7, y: 0, width: 8, height: first.bounds.y - 8 },
		];
		const probe = (allocation: GridCrossingAllocation) => {
			const route6 = crossingRoute(routing, allocation, defined(crossing[6])).route;
			const route7 = crossingRoute(routing, allocation, defined(crossing[7])).route;
			if (
				obstacles6.some((bounds) => hits(route6, bounds)) ||
				obstacles7.some((bounds) => hits(route7, bounds))
			)
				return {
					candidate: allocation,
					failure: regionGeometryDiagnostic(
						RegionGeometryDiagnosticCode.GridCrossingEntersElement,
						'The charged routes intersect a declared obstacle.',
						{ relationId: 'r6', relatedRelationId: 'r7' },
					),
				};
			return { candidate: allocation };
		};
		const result = searchGridCrossingAllocations(allocationInput, probe, {
			reallocate: 256,
			extraTrack: 1,
			bridge: 1,
		});
		if (!('selected' in result)) throw new Error(result.failure.message);
		expect(result.witness.winningPhase).toBe('reallocate');
		expect(result.witness.phases[0]?.exploredGeometries).toBeLessThan(256);
		const allocation = result.selected.allocation;
		expect(allocation.rowTrackByRelationId?.[1]?.has('r7')).toBe(true);
		expect(allocation.rowTrackByRelationId?.some((tracks) => tracks.has('r6'))).toBe(false);
		expect(allocation.busTrackByRelationId.get('r6')).not.toBe(6);
	});
});
