import {
	defined,
	EndpointKind,
	type LogicRelation,
} from '../../../../src/lib/core/document/logic-document';
import type { TopologicalRanks } from '../../../../src/lib/core/graph/topological-ranks';
import {
	crossingIncidence,
	gridRoutingEdges,
} from '../../../../src/lib/core/layout/grid-cell-crossing';
import {
	canonicalCrossingAllocation,
	type CrossingAllocationInput,
	type GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grid-cell-crossing-allocation';
import {
	crossingPortalSpans,
	crossingRoute,
	type GridCrossingRouting,
} from '../../../../src/lib/core/layout/grid-cell-crossing-routing';
import type { GridCellPlacement } from '../../../../src/lib/core/layout/grid-cell-types';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';

export interface VariedGridRoutingCase {
	readonly input: CrossingAllocationInput;
	readonly routing: GridCrossingRouting;
	readonly crossing: readonly LogicRelation[];
}

export function variedGridRoutingCase(
	crossingCount: number,
	columnCount: number,
	seed: number,
	sameRail = false,
): VariedGridRoutingCase {
	let rowCount = 1 + (seed % 3);
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

export function effectiveRouteGeometry(
	routing: GridCrossingRouting,
	crossing: readonly LogicRelation[],
	allocation: GridCrossingAllocation,
): string {
	return JSON.stringify(crossing.map((relation) => crossingRoute(routing, allocation, relation)));
}
