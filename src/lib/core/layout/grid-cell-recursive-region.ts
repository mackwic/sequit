import { defined, type LogicDocument } from '../document/logic-document';
import { createGraph, type LogicGraph } from '../graph/create-graph';
import { crossingEndpointSide, gridMargin, gridRoutingEdges } from './grid-cell-crossing';
import { gridCrossingOwnedRoutes } from './grid-cell-crossing-routing';
import { type GridCellDisposition, layoutGridCellDisposition } from './grid-cell-disposition';
import { gridCellInheritedIncidentPaths } from './grid-cell-inherited-incident';
import { routePlacedGridCellDisposition } from './grid-cell-layout';
import { normalize } from './grid-cell-model';
import { type GridCellInput, GridCellLayoutStatus } from './grid-cell-types';
import { type SolvedRecursiveRegion, translatedChildren } from './nested-region-recursive-geometry';
import type { RecursiveContext } from './nested-region-recursive-model-adapter';
import type {
	ArrangementIncidentInput,
	ArrangementPlaceInput,
	ArrangementRouteInput,
	RegionArrangement,
} from './region-arrangement';
import { RegionPortalSide } from './region-composition-types';
import {
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-layout';
import { RegionSearchProvenance } from './region-search-evidence';

function gridCellInput(context: RecursiveContext, regionId: string): GridCellInput {
	const region = defined(context.model.regionsById.get(regionId));
	const grid = defined(region.definition.grid);
	const childIds = new Set(region.childIds);
	const foreignCell = grid.cells.some(({ regionId: id }) => !childIds.has(id));
	if (grid.cells.length !== childIds.size || foreignCell)
		throw new UnsupportedRegionLeafLayoutError(`Region ${regionId} has an invalid grid cell set.`);
	const cells = grid.cells.map((cell) => {
		const { regionId: id, row, column } = cell;
		const child = defined(context.model.regionsById.get(id));
		const base = { id, parentId: regionId, row, column };
		if (child.definition.layout === undefined) return base;
		return { ...base, layout: child.definition.layout };
	});
	const cellByEndpointId = new Map<string, string>();
	for (const [endpointId, leafId] of context.model.leafByEndpointId) {
		const childId = gridChildForLeaf(context, regionId, leafId);
		if (childId !== undefined && childIds.has(childId)) cellByEndpointId.set(endpointId, childId);
	}
	return {
		rootId: regionId,
		cells,
		cellByEndpointId,
		minimumColumnWidths: grid.minimumColumnWidths,
		minimumRowHeights: grid.minimumRowHeights,
	};
}

function gridChildForLeaf(
	context: RecursiveContext,
	regionId: string,
	leafId: string,
): string | undefined {
	let descendant = leafId;
	for (let depth = 0; depth < context.model.regionsById.size; depth += 1) {
		const parentId = context.model.regionsById.get(descendant)?.parentId;
		if (parentId === regionId) return descendant;
		if (parentId === undefined) return undefined;
		descendant = parentId;
	}
	return undefined;
}

function localGridDocument(context: RecursiveContext, input: GridCellInput): LogicDocument {
	const source = context.graph.document;
	const endpointIds = new Set(input.cellByEndpointId.keys());
	const region = defined(context.model.regionsById.get(input.rootId));
	return {
		persistenceFormat: source.persistenceFormat,
		id: source.id,
		title: source.title,
		layout: region.definition.layout ?? source.layout,
		natures: source.natures,
		nodes: source.nodes.filter(({ id }) => endpointIds.has(id)),
		groups: source.groups.filter(({ id }) => endpointIds.has(id)),
		junctions: source.junctions.filter(({ id }) => endpointIds.has(id)),
		relations: source.relations.filter(
			({ from, to }) => endpointIds.has(from) && endpointIds.has(to),
		),
	};
}

interface GridPlaced {
	readonly graph: LogicGraph;
	readonly input: GridCellInput;
	readonly disposition: GridCellDisposition;
}

const GRID_INCIDENT_SIDES: readonly RegionPortalSide[] = [
	RegionPortalSide.Top,
	RegionPortalSide.Right,
	RegionPortalSide.Bottom,
	RegionPortalSide.Left,
];

function cellTouchesSide(
	cell: { readonly row: number; readonly column: number },
	side: RegionPortalSide,
	extent: { readonly rows: number; readonly columns: number },
): boolean {
	switch (side) {
		case RegionPortalSide.Top:
			return cell.row === 0;
		case RegionPortalSide.Bottom:
			return cell.row === extent.rows - 1;
		case RegionPortalSide.Left:
			return cell.column === 0;
		case RegionPortalSide.Right:
			return cell.column === extent.columns - 1;
		default:
			throw new Error('Unknown grid side.');
	}
}

function gridIncidentSides(input: ArrangementIncidentInput): readonly RegionPortalSide[] {
	const region = defined(input.context.model.regionsById.get(input.regionId));
	const grid = defined(region.definition.grid);
	if (
		grid.cells.length !== region.childIds.length ||
		grid.cells.some(({ regionId }) => !region.childIds.includes(regionId))
	)
		throw new UnsupportedRegionLeafLayoutError(
			`Region ${input.regionId} has an invalid grid cell set.`,
		);
	const cell = grid.cells.find(({ regionId }) => regionId === input.childId);
	if (cell === undefined)
		throw new UnsupportedRegionLeafLayoutError(
			`Region ${input.regionId} has an invalid grid cell set.`,
		);
	const extent = {
		rows: Math.max(0, ...grid.cells.map(({ row }) => row + 1)),
		columns: Math.max(0, ...grid.cells.map(({ column }) => column + 1)),
	};
	const outward = crossingEndpointSide(cell.column, extent.columns);
	if (input.inheritedSides === undefined) return [outward];
	const direct = input.inheritedSides.filter((side) => cellTouchesSide(cell, side, extent));
	return [...new Set([...direct, outward, ...input.inheritedSides, ...GRID_INCIDENT_SIDES])];
}

function localGridGraph(document: LogicDocument, regionId: string): LogicGraph {
	const result = createGraph(document);
	if (!result.ok)
		throw new UnsupportedRegionLeafLayoutError(
			`Grid region ${regionId} has an invalid local graph.`,
		);
	return result.value;
}

function placeGrid(input: ArrangementPlaceInput): GridPlaced {
	const gridInput = gridCellInput(input.context, input.regionId);
	const document = localGridDocument(input.context, gridInput);
	const graph = localGridGraph(document, input.regionId);
	const grid = normalize(graph, gridInput);
	if (typeof grid === 'string') throw new UnsupportedRegionLeafLayoutError(grid);
	const childrenById = new Map(input.children.map((child) => [child.id, child.solved]));
	const solvedCells = grid.cells.map((cell) => {
		const solved = childrenById.get(cell.id);
		if (solved === undefined)
			throw new UnsupportedRegionLeafLayoutError(
				`Grid region ${input.regionId} has no solved child cell ${cell.id}.`,
			);
		return { cell, layout: solved.layout, ranks: solved.ranks };
	});
	const margin = gridMargin(
		gridRoutingEdges(input.regionId, gridInput.minimumColumnWidths.length, input.crossings.length),
	);
	return {
		graph,
		input: gridInput,
		disposition: layoutGridCellDisposition(solvedCells, gridInput, margin),
	};
}

function routeGrid(input: ArrangementRouteInput<GridPlaced>): SolvedRecursiveRegion {
	const { context, regionId, placement } = input;
	const childrenById = new Map(input.children.map(({ id, solved }) => [id, solved]));
	const attempt = routePlacedGridCellDisposition({
		graph: placement.graph,
		input: placement.input,
		model: context.model,
		disposition: placement.disposition,
	});
	if (attempt.status === GridCellLayoutStatus.Unsupported)
		throw new UnsupportedRegionLeafLayoutError(attempt.reason);
	if (attempt.status === GridCellLayoutStatus.Unknown) {
		throw new UnknownRegionLeafLayoutError(
			attempt.reason,
			{
				provenance: RegionSearchProvenance.Grid,
				code: attempt.code,
				witness: attempt.witness,
			},
			regionId,
		);
	}
	const incidentPaths = gridCellInheritedIncidentPaths({
		context,
		regionId,
		incidentSides: input.incidentSides,
		selected: attempt,
		children: childrenById,
	});
	const placements = input.children.map(({ id }) =>
		defined(attempt.cells.find((cell) => cell.id === id)),
	);
	const placedChildren = translatedChildren(input.children, placements);
	return {
		layout: attempt.layout,
		ranks: { bands: [], byEndpointId: new Map() },
		regions: placedChildren.regions,
		portals: [...placedChildren.portals, ...attempt.portals],
		ownedRoutes: [
			...placedChildren.ownedRoutes,
			...gridCrossingOwnedRoutes(
				regionId,
				placement.input.cellByEndpointId,
				defined(context.model.crossingRelationsByOwner.get(regionId)),
				new Map(attempt.layout.relations.map((route) => [route.id, route])),
			),
		],
		incidentPaths,
	};
}

/** Grid placement and routing implement the same contract as the row arrangement. */
export const gridCellArrangement: RegionArrangement<GridPlaced> = {
	// Grid rails are fixed; retryable side alternatives arrive with the grid disposition.
	alternativeSides: [],
	incidentSides: gridIncidentSides,
	place: placeGrid,
	route: routeGrid,
};
