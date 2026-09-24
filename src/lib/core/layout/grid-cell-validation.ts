import { defined, EndpointKind, type LogicRelation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { crossingIncidence, crossingOverlap } from './grid-cell-crossing';
import {
	entersInterior,
	equal,
	finiteBounds,
	gridTracksAligned,
	sameBounds,
	samePoint,
	validPath,
	within,
} from './grid-cell-geometry-primitives';
import { validateGridCellGroupContainment } from './grid-cell-group-validation';
import { validateGridCellLaneGeometry } from './grid-cell-lane-validation';
import { gridRectangle } from './grid-cell-model';
import {
	validateCrossPortals,
	validateCrossPorts,
	validateCrossPortStacking,
} from './grid-cell-port-validation';
import type { GridCellInput, GridCellPlacement, GridCellSelected } from './grid-cell-types';
import type { Bounds, LayoutRelation } from './layout-types';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from './region-geometry-diagnostic';

interface CrossContext {
	readonly graph: LogicGraph;
	readonly fromCell: GridCellPlacement;
	readonly toCell: GridCellPlacement;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

function ancestorGroups(graph: LogicGraph, endpointId: string): ReadonlySet<string> {
	const ancestors = new Set<string>();
	const endpoint = graph.endpointsById.get(endpointId);
	if (endpoint?.kind !== EndpointKind.Node && endpoint?.kind !== EndpointKind.Group)
		return ancestors;
	let groupId = endpoint.entity.groupId;
	for (let depth = 0; groupId !== undefined && depth < graph.endpointsById.size; depth += 1) {
		if (ancestors.has(groupId)) break;
		const group = graph.endpointsById.get(groupId);
		if (group?.kind !== EndpointKind.Group) break;
		ancestors.add(groupId);
		groupId = group.entity.groupId;
	}
	return ancestors;
}

function checkCell(
	candidate: GridCellSelected,
	input: GridCellInput,
	cell: GridCellPlacement,
	root: Bounds,
): string | undefined {
	if (!finiteBounds(cell.bounds) || !within(root, cell.bounds))
		return `Cell ${cell.id} leaves the root canvas.`;
	const declared = input.cells.find(
		({ row, column }) => row === cell.row && column === cell.column,
	);
	if (cell.parentId !== candidate.rootId || cell.id !== declared?.id)
		return `Cell ${cell.id} has invalid ownership.`;
	const correctWidth = equal(cell.bounds.width, defined(candidate.columnWidths[cell.column]));
	const correctHeight = equal(cell.bounds.height, defined(candidate.rowHeights[cell.row]));
	if (!correctWidth || !correctHeight) return `Cell ${cell.id} does not fill its grid tracks.`;
	const published = candidate.layout.regions?.find(({ id }) => id === cell.id);
	if (published === undefined || !sameBounds(published.bounds, cell.bounds))
		return `Cell ${cell.id} has a different published frame.`;
	const localCanvas = {
		x: cell.translation.x,
		y: cell.translation.y,
		width: cell.localLayout.width,
		height: cell.localLayout.height,
	};
	if (!within(cell.bounds, localCanvas)) return `Cell ${cell.id} clips its independent layout.`;
	return undefined;
}

function checkAlignment(cells: readonly GridCellPlacement[]): string | undefined {
	if (!gridTracksAligned(cells)) return 'Grid tracks are misaligned or overlap.';
	return undefined;
}

function cellGeometry(candidate: GridCellSelected, input: GridCellInput): string | undefined {
	const { cells, columnWidths, rowHeights, layout } = candidate;
	if (gridRectangle(cells) === undefined || layout.regions?.length !== cells.length)
		return 'The composed layout must contain each grid cell exactly once.';
	if (
		columnWidths.length !== input.minimumColumnWidths.length ||
		rowHeights.length !== input.minimumRowHeights.length
	)
		return 'The composed layout tracks disagree with the cell rectangle.';
	if (columnWidths.some((width, index) => width < defined(input.minimumColumnWidths[index])))
		return 'A track fell below its minimum extent.';
	if (rowHeights.some((height, index) => height < defined(input.minimumRowHeights[index])))
		return 'A track fell below its minimum extent.';
	const root = { x: 0, y: 0, width: layout.width, height: layout.height };
	if (!finiteBounds(root)) return 'The root canvas has invalid extent.';
	for (const cell of cells) {
		const failure = checkCell(candidate, input, cell, root);
		if (failure !== undefined) return failure;
	}
	return checkAlignment(cells);
}

function elementGeometry(
	candidate: GridCellSelected,
	graph: LogicGraph,
	input: GridCellInput,
): string | undefined {
	const elements = new Map(candidate.layout.elements.map((element) => [element.id, element]));
	if (elements.size !== graph.endpointsById.size)
		return 'The composed layout does not contain each endpoint exactly once.';
	if (candidate.layout.elements.length !== elements.size)
		return 'The composed layout does not contain each endpoint exactly once.';
	for (const [id] of graph.endpointsById) {
		const cell = candidate.cells.find(
			({ id: cellId }) => cellId === input.cellByEndpointId.get(id),
		);
		const local = cell?.localLayout.elements.find((element) => element.id === id);
		const global = elements.get(id);
		if (cell === undefined) return `Endpoint ${id} has missing geometry.`;
		if (local === undefined) return `Endpoint ${id} has missing geometry.`;
		if (global === undefined) return `Endpoint ${id} has missing geometry.`;
		if (!finiteBounds(global.bounds)) return `Endpoint ${id} has missing geometry.`;
		const expected = {
			x: local.bounds.x + cell.translation.x,
			y: local.bounds.y + cell.translation.y,
			width: local.bounds.width,
			height: local.bounds.height,
		};
		if (!sameBounds(global.bounds, expected) || !within(cell.bounds, global.bounds))
			return `Endpoint ${id} escapes or disagrees with its cell layout.`;
	}
	return undefined;
}

function checkLocalRoute(route: LayoutRelation, cell: GridCellPlacement): string | undefined {
	const local = cell.localLayout.relations.find(({ id }) => id === route.id);
	if (local?.points.length !== route.points.length)
		return `Local relation ${route.id} disagrees with its child layout.`;
	for (const [index, point] of local.points.entries()) {
		const expected = {
			x: point.x + cell.translation.x,
			y: point.y + cell.translation.y,
		};
		if (!samePoint(defined(route.points[index]), expected))
			return `Local relation ${route.id} disagrees with its child layout.`;
	}
	return undefined;
}

function checkSegment(
	candidate: GridCellSelected,
	route: LayoutRelation,
	context: CrossContext,
	index: number,
): RegionGeometryDiagnostic | undefined {
	const start = defined(route.points[index]);
	const end = defined(route.points[index + 1]);
	const last = route.points.length - 2;
	let allowedGroupIds: ReadonlySet<string> = new Set();
	if (index === 0) allowedGroupIds = ancestorGroups(context.graph, route.from);
	if (index === last) allowedGroupIds = ancestorGroups(context.graph, route.to);
	const crossedCell = candidate.cells.find((cell) => {
		if (index === 0 && cell.id === context.fromCell.id) return false;
		if (index === last && cell.id === context.toCell.id) return false;
		return entersInterior(start, end, cell.bounds);
	});
	if (crossedCell !== undefined)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridCrossingEntersCell,
			`Cross-cell relation ${route.id} enters opaque cell ${crossedCell.id}.`,
			{ relationId: route.id, regionId: crossedCell.id },
		);
	const crossedElement = candidate.layout.elements.find((element) => {
		if (index === 0 && element.id === route.from) return false;
		if (index === last && element.id === route.to) return false;
		if (allowedGroupIds.has(element.id)) return false;
		return entersInterior(start, end, element.bounds);
	});
	if (crossedElement !== undefined)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridCrossingEntersElement,
			`Cross-cell relation ${route.id} enters element ${crossedElement.id}.`,
			{ relationId: route.id, endpointId: crossedElement.id },
		);
	return undefined;
}

function checkCrossRoute(
	candidate: GridCellSelected,
	route: LayoutRelation,
	context: CrossContext,
): RegionGeometryDiagnostic | undefined {
	const portFailure = validateCrossPorts(candidate, route, context);
	if (portFailure !== undefined)
		return regionGeometryDiagnostic(RegionGeometryDiagnosticCode.GridCrossingPort, portFailure, {
			relationId: route.id,
		});
	const portalFailure = validateCrossPortals(candidate, route, context.fromCell, context.toCell);
	if (portalFailure !== undefined)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridCrossingPortal,
			portalFailure,
			{
				relationId: route.id,
			},
		);
	for (let index = 0; index < route.points.length - 1; index += 1) {
		const diagnostic = checkSegment(candidate, route, context, index);
		if (diagnostic !== undefined) return diagnostic;
	}
	return undefined;
}

interface RelationCheckContext {
	readonly candidate: GridCellSelected;
	readonly graph: LogicGraph;
	readonly input: GridCellInput;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

function checkRelationGeometry(
	context: RelationCheckContext,
	relation: LogicRelation,
	route: LayoutRelation | undefined,
): RegionGeometryDiagnostic | undefined {
	if (route === undefined)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridRelationGeometry,
			`Relation ${relation.id} has an invalid path.`,
			{ relationId: relation.id },
		);
	const wrongEndpoints = route.from !== relation.from || route.to !== relation.to;
	if (wrongEndpoints || !validPath(route))
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridRelationGeometry,
			`Relation ${relation.id} has an invalid path.`,
			{ relationId: relation.id },
		);
	const { candidate, graph, input, incidence } = context;
	const fromCell = defined(
		candidate.cells.find(({ id }) => id === input.cellByEndpointId.get(relation.from)),
	);
	const toCell = defined(
		candidate.cells.find(({ id }) => id === input.cellByEndpointId.get(relation.to)),
	);
	if (fromCell.id !== toCell.id)
		return checkCrossRoute(candidate, route, { graph, fromCell, toCell, incidence });
	const failure = checkLocalRoute(route, fromCell);
	if (failure === undefined) return undefined;
	return regionGeometryDiagnostic(RegionGeometryDiagnosticCode.GridRelationGeometry, failure, {
		relationId: relation.id,
		regionId: fromCell.id,
	});
}

function relationGeometry(
	candidate: GridCellSelected,
	graph: LogicGraph,
	input: GridCellInput,
): RegionGeometryDiagnostic | undefined {
	const routes = new Map(candidate.layout.relations.map((route) => [route.id, route]));
	if (routes.size !== graph.relations.length || routes.size !== candidate.layout.relations.length)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridRelationGeometry,
			'The composed layout does not contain each relation exactly once.',
		);
	const crossing = graph.relations
		.map(({ relation }) => relation)
		.filter(({ from, to }) => input.cellByEndpointId.get(from) !== input.cellByEndpointId.get(to));
	const context = { candidate, graph, input, incidence: crossingIncidence(crossing) };
	for (const { relation } of graph.relations) {
		const failure = checkRelationGeometry(context, relation, routes.get(relation.id));
		if (failure !== undefined) return failure;
	}
	const stacking = validateCrossPortStacking(candidate, crossing);
	if (stacking !== undefined)
		return regionGeometryDiagnostic(RegionGeometryDiagnosticCode.GridCrossingPort, stacking);
	const overlap = crossingOverlap(crossing.map(({ id }) => defined(routes.get(id))));
	if (overlap !== undefined)
		return regionGeometryDiagnostic(RegionGeometryDiagnosticCode.GridCrossingOverlap, overlap);
	return undefined;
}

/** Separate typed geometric checker for every candidate selected by the grid composer. */
export function validateGridCellGeometryDiagnostic(
	candidate: GridCellSelected,
	graph: LogicGraph,
	input: GridCellInput,
): RegionGeometryDiagnostic | undefined {
	const cellFailure = cellGeometry(candidate, input);
	if (cellFailure !== undefined)
		return regionGeometryDiagnostic(RegionGeometryDiagnosticCode.GridCellGeometry, cellFailure);
	const elementFailure = elementGeometry(candidate, graph, input);
	if (elementFailure !== undefined)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridElementGeometry,
			elementFailure,
		);
	const groupFailure = validateGridCellGroupContainment(candidate, graph);
	if (groupFailure !== undefined)
		return regionGeometryDiagnostic(RegionGeometryDiagnosticCode.GridGroupGeometry, groupFailure);
	const laneFailure = validateGridCellLaneGeometry(candidate);
	if (laneFailure !== undefined)
		return regionGeometryDiagnostic(RegionGeometryDiagnosticCode.GridLaneGeometry, laneFailure);
	return relationGeometry(candidate, graph, input);
}

/** Existing display-message adapter; solver decisions use the typed diagnostic. */
export function validateGridCellGeometry(
	candidate: GridCellSelected,
	graph: LogicGraph,
	input: GridCellInput,
): string | undefined {
	return validateGridCellGeometryDiagnostic(candidate, graph, input)?.message;
}
