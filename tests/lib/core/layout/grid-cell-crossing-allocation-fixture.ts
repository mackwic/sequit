import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicRelation,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import type { TopologicalRanks } from '../../../../src/lib/core/graph/topological-ranks';
import { unbridgedContacts } from '../../../../src/lib/core/layout/bridge-contact';
import { validatedBridges } from '../../../../src/lib/core/layout/bridge-oracle';
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
	gridCrossingOwnedRoutes,
	type GridCrossingRouting,
} from '../../../../src/lib/core/layout/grid-cell-crossing-routing';
import type { GridCellPlacement } from '../../../../src/lib/core/layout/grid-cell-types';
import {
	type GridCellInput,
	GridCellLayoutStatus,
	type GridCellSelected,
} from '../../../../src/lib/core/layout/grid-cell-types';
import { validateGridCellGeometryDiagnostic } from '../../../../src/lib/core/layout/grid-cell-validation';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/region-geometry-diagnostic';

export interface VariedGridRoutingCase {
	readonly input: CrossingAllocationInput;
	readonly routing: GridCrossingRouting;
	readonly crossing: readonly LogicRelation[];
	readonly graph: LogicGraph;
	readonly gridInput: GridCellInput;
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
			const endpointId = `task-${cell.row}-${cell.column}`;
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
	const source: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'property-grid',
		title: 'Grid route geometry property',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes: [...cellByEndpointId.keys()].map((id, index) => ({
			kind: EndpointKind.Node as const,
			id,
			natureId: 'task',
			markdown: `${id}\n`,
			layoutOrder: orderKey(`a${String.fromCharCode(65 + index)}`),
		})),
		relations: crossing,
	};
	const prepared = createGraph(source);
	if (!prepared.ok) throw new Error('Generated grid document must be a valid graph.');
	const gridInput: GridCellInput = {
		rootId: routing.rootId,
		cells: cells.map(({ id, row, column }) => ({ id, parentId: routing.rootId, row, column })),
		cellByEndpointId,
		minimumColumnWidths: Array<number>(columnCount).fill(520),
		minimumRowHeights: Array<number>(rowCount).fill(300),
	};
	const canonical = canonicalCrossingAllocation(allocationInput);
	return {
		input: {
			...allocationInput,
			portalByRelationId: crossingPortalSpans(routing, canonical),
		},
		routing,
		crossing,
		graph: prepared.value,
		gridInput,
	};
}

export function effectiveRouteGeometry(
	routing: GridCrossingRouting,
	crossing: readonly LogicRelation[],
	allocation: GridCrossingAllocation,
): string {
	return JSON.stringify(crossing.map((relation) => crossingRoute(routing, allocation, relation)));
}

/** Evaluate the generated candidate with the same grid geometry and route-contact oracles as production. */
export function routeGridFixture(
	fixture: VariedGridRoutingCase,
	allocation: GridCrossingAllocation,
	acceptBridges: boolean,
): {
	readonly candidate: GridCellSelected;
	readonly failure?: ReturnType<typeof regionGeometryDiagnostic>;
} {
	const { routing, crossing, graph, gridInput } = fixture;
	const routed = crossing.map((relation) => crossingRoute(routing, allocation, relation));
	const cells = routing.cells;
	const elements = cells.flatMap((cell) =>
		cell.localLayout.elements.map((element) => ({
			...element,
			bounds: {
				...element.bounds,
				x: element.bounds.x + cell.translation.x,
				y: element.bounds.y + cell.translation.y,
			},
		})),
	);
	const candidate: GridCellSelected = {
		status: GridCellLayoutStatus.Selected,
		rootId: routing.rootId,
		layout: {
			width: Math.max(...cells.map(({ bounds }) => bounds.x + bounds.width)) + 100,
			height: Math.max(...cells.map(({ bounds }) => bounds.y + bounds.height)) + 100,
			elements,
			relations: routed.map(({ route }) => route),
			regions: cells.map(({ id, bounds }) => ({ id, bounds })),
		},
		cells,
		columnWidths: Array<number>(routing.columnCount).fill(520),
		rowHeights: Array<number>(cells.length / routing.columnCount).fill(300),
		portals: routed.flatMap(({ portals }) => portals),
	};
	const failure = validateGridCellGeometryDiagnostic(candidate, graph, gridInput);
	if (failure !== undefined) return { candidate, failure };
	const byId = new Map(candidate.layout.relations.map((route) => [route.id, route]));
	const owned = gridCrossingOwnedRoutes(
		routing.rootId,
		routing.cellByEndpointId,
		crossing,
		byId,
	).filter(({ regionId }) => regionId === routing.rootId);
	let bridges: ReturnType<typeof validatedBridges> = [];
	if (acceptBridges) bridges = validatedBridges(candidate.layout.relations);
	for (const [index, first] of owned.entries()) {
		for (const second of owned.slice(index + 1)) {
			if (
				unbridgedContacts(
					{ id: first.relationId, points: first.points },
					{ id: second.relationId, points: second.points },
					bridges,
				).length === 0
			)
				continue;
			return {
				candidate,
				failure: regionGeometryDiagnostic(
					RegionGeometryDiagnosticCode.ParentRouteContact,
					`Region ${routing.rootId} routes ${first.relationId} and ${second.relationId} intersect without a bridge.`,
					{
						relationId: first.relationId,
						relatedRelationId: second.relationId,
						regionId: routing.rootId,
					},
				),
			};
		}
	}
	return { candidate };
}
