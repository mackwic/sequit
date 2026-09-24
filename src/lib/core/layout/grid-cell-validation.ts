import { defined, EndpointKind } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { crossingIncidence, crossingOverlap } from './grid-cell-crossing';
import {
	entersInterior,
	equal,
	finiteBounds,
	sameBounds,
	samePoint,
	validPath,
	within,
} from './grid-cell-geometry-primitives';
import { validateGridCellGroupContainment } from './grid-cell-group-validation';
import { validateGridCellLaneGeometry } from './grid-cell-lane-validation';
import { validateCrossPortals, validateCrossPorts } from './grid-cell-port-validation';
import type { GridCellInput, GridCellPlacement, GridCellSelected } from './grid-cell-types';
import type { Bounds, LayoutRelation } from './layout-types';

interface CrossContext {
	readonly graph: LogicGraph;
	readonly fromCell: GridCellPlacement;
	readonly toCell: GridCellPlacement;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

function directMemberGroup(graph: LogicGraph, endpointId: string): string | undefined {
	const endpoint = graph.endpointsById.get(endpointId);
	if (endpoint?.kind !== EndpointKind.Node || endpoint.entity.groupId === undefined)
		return undefined;
	const group = graph.endpointsById.get(endpoint.entity.groupId);
	if (group?.kind !== EndpointKind.Group || group.entity.groupId !== undefined) return undefined;
	return group.entity.id;
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
	const correctWidth = equal(cell.bounds.width, candidate.columnWidths[cell.column]);
	const correctHeight = equal(cell.bounds.height, candidate.rowHeights[cell.row]);
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
	const at = (row: 0 | 1, column: 0 | 1): Bounds =>
		defined(cells.find((cell) => cell.row === row && cell.column === column)).bounds;
	const topLeft = at(0, 0);
	const topRight = at(0, 1);
	const bottomLeft = at(1, 0);
	const bottomRight = at(1, 1);
	const separatedColumns = topLeft.x + topLeft.width < topRight.x;
	const separatedRows = topLeft.y + topLeft.height < bottomLeft.y;
	const aligned = [
		equal(topLeft.x, bottomLeft.x),
		equal(topRight.x, bottomRight.x),
		equal(topLeft.y, topRight.y),
		equal(bottomLeft.y, bottomRight.y),
		separatedColumns,
		separatedRows,
	];
	if (!aligned.every(Boolean)) return 'Grid tracks are misaligned or overlap.';
	return undefined;
}

function cellGeometry(candidate: GridCellSelected, input: GridCellInput): string | undefined {
	const { cells, columnWidths, rowHeights, layout } = candidate;
	if (cells.length !== 4 || layout.regions?.length !== 4)
		return 'The composed layout must publish four cells.';
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
): string | undefined {
	const start = defined(route.points[index]);
	const end = defined(route.points[index + 1]);
	const last = route.points.length - 2;
	let allowedGroupId: string | undefined;
	if (index === 0) allowedGroupId = directMemberGroup(context.graph, route.from);
	if (index === last) allowedGroupId = directMemberGroup(context.graph, route.to);
	const crossedCell = candidate.cells.find((cell) => {
		if (index === 0 && cell.id === context.fromCell.id) return false;
		if (index === last && cell.id === context.toCell.id) return false;
		return entersInterior(start, end, cell.bounds);
	});
	if (crossedCell !== undefined)
		return `Cross-cell relation ${route.id} enters opaque cell ${crossedCell.id}.`;
	const crossedElement = candidate.layout.elements.find((element) => {
		if (index === 0 && element.id === route.from) return false;
		if (index === last && element.id === route.to) return false;
		if (element.id === allowedGroupId) return false;
		return entersInterior(start, end, element.bounds);
	});
	if (crossedElement !== undefined)
		return `Cross-cell relation ${route.id} enters element ${crossedElement.id}.`;
	return undefined;
}

function checkCrossRoute(
	candidate: GridCellSelected,
	route: LayoutRelation,
	context: CrossContext,
): string | undefined {
	const portFailure = validateCrossPorts(candidate, route, context);
	if (portFailure !== undefined) return portFailure;
	const portalFailure = validateCrossPortals(candidate, route, context.fromCell, context.toCell);
	if (portalFailure !== undefined) return portalFailure;
	for (let index = 0; index < route.points.length - 1; index += 1) {
		const failure = checkSegment(candidate, route, context, index);
		if (failure !== undefined) return failure;
	}
	return undefined;
}

function relationGeometry(
	candidate: GridCellSelected,
	graph: LogicGraph,
	input: GridCellInput,
): string | undefined {
	const routes = new Map(candidate.layout.relations.map((route) => [route.id, route]));
	if (routes.size !== graph.relations.length || routes.size !== candidate.layout.relations.length)
		return 'The composed layout does not contain each relation exactly once.';
	const crossing = graph.relations
		.map(({ relation }) => relation)
		.filter(({ from, to }) => input.cellByEndpointId.get(from) !== input.cellByEndpointId.get(to));
	const incidence = crossingIncidence(crossing);
	for (const { relation } of graph.relations) {
		const route = routes.get(relation.id);
		if (route === undefined) return `Relation ${relation.id} has an invalid path.`;
		if (route.from !== relation.from || route.to !== relation.to)
			return `Relation ${relation.id} has an invalid path.`;
		if (!validPath(route)) return `Relation ${relation.id} has an invalid path.`;
		const fromCell = defined(
			candidate.cells.find(({ id }) => id === input.cellByEndpointId.get(relation.from)),
		);
		const toCell = defined(
			candidate.cells.find(({ id }) => id === input.cellByEndpointId.get(relation.to)),
		);
		let failure: string | undefined;
		if (fromCell.id === toCell.id) failure = checkLocalRoute(route, fromCell);
		else
			failure = checkCrossRoute(candidate, route, {
				graph,
				fromCell,
				toCell,
				incidence,
			});
		if (failure !== undefined) return failure;
	}
	return crossingOverlap(crossing.map(({ id }) => defined(routes.get(id))));
}

/** Separate geometric checker for every candidate selected by the bounded grid composer. */
export function validateGridCellGeometry(
	candidate: GridCellSelected,
	graph: LogicGraph,
	input: GridCellInput,
): string | undefined {
	const cellFailure = cellGeometry(candidate, input);
	if (cellFailure !== undefined) return cellFailure;
	const elementFailure = elementGeometry(candidate, graph, input);
	if (elementFailure !== undefined) return elementFailure;
	const groupFailure = validateGridCellGroupContainment(candidate, graph);
	if (groupFailure !== undefined) return groupFailure;
	const laneFailure = validateGridCellLaneGeometry(candidate);
	if (laneFailure !== undefined) return laneFailure;
	return relationGeometry(candidate, graph, input);
}
