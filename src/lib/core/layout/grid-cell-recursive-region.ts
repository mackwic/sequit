import { defined, type LogicDocument, type LogicRelation } from '../document/logic-document';
import { createGraph, type LogicGraph } from '../graph/create-graph';
import { crossingMargin } from './grid-cell-crossing';
import { type GridCellDisposition, layoutGridCellDisposition } from './grid-cell-disposition';
import {
	extendedToCellFrame,
	gridCellInheritedIncidentPaths,
} from './grid-cell-inherited-incident';
import { materializePlacedGridCellDisposition } from './grid-cell-layout';
import { normalize } from './grid-cell-model';
import type { GridCellInput, GridCellSelected } from './grid-cell-types';
import type { LayoutRelation, Point } from './layout-types';
import {
	type RegionIncidentPath,
	type SolvedRecursiveRegion,
	stitchedRoute,
	translatedChildren,
	translatedIncidentPath,
} from './nested-region-recursive-geometry';
import { directChild, type RecursiveContext } from './nested-region-recursive-model-adapter';
import type {
	ArrangementIncidentInput,
	ArrangementPlaceInput,
	ArrangementRouteInput,
	RegionArrangement,
} from './region-arrangement';
import {
	type RegionOwnedRoute,
	type RegionPortal,
	RegionPortalSide,
} from './region-composition-types';
import { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';
import {
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-layout';

function gridCellInput(context: RecursiveContext, regionId: string): GridCellInput {
	const region = defined(context.model.regionsById.get(regionId));
	const grid = defined(region.definition.grid);
	const childIds = new Set(region.childIds);
	const wrongCount = childIds.size !== 4 || grid.cells.length !== 4;
	const foreignCell = grid.cells.some(({ regionId: id }) => !childIds.has(id));
	if (wrongCount || foreignCell)
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
	cell: { readonly row: 0 | 1; readonly column: 0 | 1 },
	side: RegionPortalSide,
): boolean {
	switch (side) {
		case RegionPortalSide.Top:
			return cell.row === 0;
		case RegionPortalSide.Bottom:
			return cell.row === 1;
		case RegionPortalSide.Left:
			return cell.column === 0;
		case RegionPortalSide.Right:
			return cell.column === 1;
		default:
			throw new Error('Unknown grid side.');
	}
}

function gridIncidentSides(input: ArrangementIncidentInput): readonly RegionPortalSide[] {
	const region = defined(input.context.model.regionsById.get(input.regionId));
	const grid = defined(region.definition.grid);
	if (
		grid.cells.length !== 4 ||
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
	let outward = RegionPortalSide.Left;
	if (cell.column === 1) outward = RegionPortalSide.Right;
	if (input.inheritedSides === undefined) return [outward];
	const direct = input.inheritedSides.filter((side) => cellTouchesSide(cell, side));
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
	const margin = crossingMargin(input.crossings.length);
	return {
		graph,
		input: gridInput,
		disposition: layoutGridCellDisposition(solvedCells, gridInput, margin),
	};
}

interface GridCrossingComposition {
	readonly routes: ReadonlyMap<string, LayoutRelation>;
	readonly portals: readonly RegionPortal[];
	readonly ownedRoutes: readonly RegionOwnedRoute[];
}

function unknownGridPath(regionId: string, relationId: string, detail: string): never {
	throw new UnknownRegionLeafLayoutError(
		`Grid region ${regionId} relation ${relationId}: ${detail}`,
		RegionGeometryDiagnosticCode.GridCrossingPortal,
		undefined,
		regionId,
	);
}

interface CellIncidentPathInput {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly selected: GridCellSelected;
	readonly children: ReadonlyMap<string, SolvedRecursiveRegion>;
	readonly relation: LogicRelation;
	readonly source: boolean;
}

function cellIncidentPath(input: CellIncidentPathInput): RegionIncidentPath {
	const { context, regionId, selected, children, relation, source } = input;
	let endpointId = relation.to;
	if (source) endpointId = relation.from;
	const childId = directChild(context, regionId, endpointId);
	const child = defined(children.get(childId));
	const cell = defined(selected.cells.find(({ id }) => id === childId));
	const path = child.incidentPaths.get(relation.id);
	const missingPath = path === undefined;
	const wrongEndpoint = path?.endpointId !== endpointId;
	const wrongRelation = path?.relationId !== relation.id;
	if (missingPath || wrongEndpoint || wrongRelation)
		unknownGridPath(regionId, relation.id, `child ${childId} has no matching incident path.`);
	return extendedToCellFrame(translatedIncidentPath(path, cell.translation), cell, source);
}

function framePortal(path: RegionIncidentPath, source: boolean): RegionPortal {
	let portal = path.portals[0];
	if (source) portal = path.portals.at(-1);
	return defined(portal);
}

interface GridTrackPieceInput {
	readonly selected: GridCellSelected;
	readonly relation: LogicRelation;
	readonly sourcePortal: RegionPortal;
	readonly targetPortal: RegionPortal;
	readonly regionId: string;
}

function gridTrackPiece(input: GridTrackPieceInput): RegionOwnedRoute {
	const { selected, relation, sourcePortal, targetPortal, regionId } = input;
	const skeleton = selected.layout.relations.find(({ id }) => id === relation.id);
	const legacyPortals = selected.portals.filter(({ relationId }) => relationId === relation.id);
	if (skeleton === undefined || legacyPortals.length !== 2)
		unknownGridPath(regionId, relation.id, 'the grid has no complete crossing track.');
	const [oldSource, oldTarget] = legacyPortals;
	if (oldSource === undefined || oldTarget === undefined)
		unknownGridPath(regionId, relation.id, 'the chosen child portals cannot meet the grid track.');
	const sameSides = sourcePortal.side === oldSource.side && targetPortal.side === oldTarget.side;
	const sameSourceX = sourcePortal.point.x === oldSource.point.x;
	const sameTargetX = targetPortal.point.x === oldTarget.point.x;
	const matchingPortals = sameSides && sameSourceX && sameTargetX;
	if (!matchingPortals)
		unknownGridPath(regionId, relation.id, 'the chosen child portals cannot meet the grid track.');
	const points = skeleton.points.slice(1, -1);
	if (points.length < 4) unknownGridPath(regionId, relation.id, 'the grid track is incomplete.');
	const startRail = defined(points[1]);
	const endRail = defined(points.at(-2));
	const adjusted: Point[] = [
		sourcePortal.point,
		{ x: startRail.x, y: sourcePortal.point.y },
		...points.slice(2, -2),
		{ x: endRail.x, y: targetPortal.point.y },
		targetPortal.point,
	];
	return { relationId: relation.id, regionId, points: adjusted };
}

/** Join the already selected child incident paths through the grid tracks. */
export function composeGridCellCrossings(
	context: RecursiveContext,
	regionId: string,
	selected: GridCellSelected,
	children: ReadonlyMap<string, SolvedRecursiveRegion>,
): GridCrossingComposition {
	const routes = new Map(selected.layout.relations.map((route) => [route.id, route]));
	const portals: RegionPortal[] = [];
	const ownedRoutes: RegionOwnedRoute[] = [];
	for (const relation of defined(context.model.crossingRelationsByOwner.get(regionId))) {
		const cellIncidentPathBase = { context, regionId, selected, children, relation };
		const sourcePath = cellIncidentPath({ ...cellIncidentPathBase, source: true });
		const targetPath = cellIncidentPath({ ...cellIncidentPathBase, source: false });
		const track = gridTrackPiece({
			selected,
			relation,
			sourcePortal: framePortal(sourcePath, true),
			targetPortal: framePortal(targetPath, false),
			regionId,
		});
		const pieces = [...sourcePath.pieces, track, ...targetPath.pieces];
		routes.set(relation.id, stitchedRoute(relation, pieces));
		portals.push(...sourcePath.portals, ...targetPath.portals);
		ownedRoutes.push(...pieces);
	}
	return { routes, portals, ownedRoutes };
}

function routeGrid(input: ArrangementRouteInput<GridPlaced>): SolvedRecursiveRegion {
	const { context, regionId, placement } = input;
	const childrenById = new Map(input.children.map(({ id, solved }) => [id, solved]));
	const selected = materializePlacedGridCellDisposition({
		graph: placement.graph,
		input: placement.input,
		model: context.model,
		disposition: placement.disposition,
	});
	const crossings = composeGridCellCrossings(context, regionId, selected, childrenById);
	const incidentPaths = gridCellInheritedIncidentPaths({
		context,
		regionId,
		incidentSides: input.incidentSides,
		selected,
		children: childrenById,
	});
	const placements = input.children.map(({ id }) =>
		defined(selected.cells.find((cell) => cell.id === id)),
	);
	const placedChildren = translatedChildren(input.children, placements);
	const layout = {
		...selected.layout,
		relations: placement.graph.relations.map(({ relation }) =>
			defined(crossings.routes.get(relation.id)),
		),
	};
	return {
		layout,
		ranks: { bands: [], byEndpointId: new Map() },
		regions: placedChildren.regions,
		portals: [...placedChildren.portals, ...crossings.portals],
		ownedRoutes: [...placedChildren.ownedRoutes, ...crossings.ownedRoutes],
		incidentPaths,
	};
}

/** Grid placement and routing implement the same contract as the row arrangement. */
export const gridCellArrangement: RegionArrangement<GridPlaced> = {
	incidentSides: gridIncidentSides,
	place: placeGrid,
	route: routeGrid,
};
