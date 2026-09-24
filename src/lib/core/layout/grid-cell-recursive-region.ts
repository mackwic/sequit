import { compareCanonicalStrings } from '../canonical-string';
import { defined, EndpointKind, type LogicDocument } from '../document/logic-document';
import { createGraph } from '../graph/create-graph';
import { satisfyMetricDemands } from './contract/metric-demand';
import { crossingIncidence, crossingMetricDemands } from './grid-cell-crossing';
import { solveContractedLaneCell } from './grid-cell-lane-incident-leaf';
import {
	laneCellIncidentFailure,
	laneCellOutgoingContract,
} from './grid-cell-lane-incident-policy';
import { composeGridCellDisposition } from './grid-cell-layout';
import { normalize } from './grid-cell-model';
import { type ExternalGridIncident, outerGridIncidentPath } from './grid-cell-outer-incident';
import {
	type GridCellInput,
	GridCellLayoutStatus,
	type GridCellSelected,
	GridCellSide,
} from './grid-cell-types';
import type { LayoutRelation } from './layout-types';
import {
	boundaryPortal,
	type RegionIncidentPath,
	type SolvedRecursiveRegion,
} from './nested-region-recursive-geometry';
import type { IncidentSides, RecursiveContext } from './nested-region-recursive-model-adapter';
import {
	type NestedOwnedRoute,
	NestedPortalSide,
	type NestedRegionPortal,
} from './nested-region-types';
import {
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-layout';

const LEAF_DETOUR_CLEARANCE = 16;

function externalIncidents(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
): readonly ExternalGridIncident[] {
	if (incidentSides.size > 2)
		throw new UnsupportedRegionLeafLayoutError(
			`Grid region ${regionId} accepts at most two outer incidents.`,
		);
	const incidents = [...incidentSides]
		.sort(([left], [right]) => compareCanonicalStrings(left, right))
		.map(([relationId, side]): ExternalGridIncident =>
			externalIncident(context, regionId, relationId, side),
		);
	if (incidents.length === 2) {
		const first = defined(incidents[0]);
		const second = defined(incidents[1]);
		const wrongSide = first.side !== NestedPortalSide.Top || second.side !== NestedPortalSide.Top;
		const sameCell = first.cellId === second.cellId;
		// Normalization creates an owner partition for every region, including empty ones.
		const hasCrossings = defined(context.model.crossingRelationsByOwner.get(regionId)).length > 0;
		if (wrongSide || sameCell || hasCrossings)
			throw new UnsupportedRegionLeafLayoutError(
				`Grid region ${regionId} requires two top incidents in distinct cells without inter-cell crossings.`,
			);
		const grid = defined(defined(context.model.regionsById.get(regionId)).definition.grid);
		const firstColumn = defined(grid.cells.find(({ regionId: id }) => id === first.cellId)).column;
		const secondColumn = defined(
			grid.cells.find(({ regionId: id }) => id === second.cellId),
		).column;
		if (firstColumn === secondColumn)
			throw new UnsupportedRegionLeafLayoutError(
				`Grid region ${regionId} requires separate columns for two outer incidents.`,
			);
	}
	return incidents;
}

function externalIncident(
	context: RecursiveContext,
	regionId: string,
	relationId: string,
	side: NestedPortalSide,
): ExternalGridIncident {
	if (side !== NestedPortalSide.Top && side !== NestedPortalSide.Bottom)
		throw new UnsupportedRegionLeafLayoutError(
			`Grid region ${regionId} requires a top or bottom outer incident.`,
		);
	const owned = defined(context.ownershipByRelationId.get(relationId));
	const source = owned.sourcePathToOwner.includes(regionId);
	let endpointId = owned.relation.to;
	if (source) endpointId = owned.relation.from;
	const endpoint = defined(context.graph.endpointsById.get(endpointId));
	if (endpoint.kind !== EndpointKind.Node || endpoint.entity.groupId !== undefined)
		throw new UnsupportedRegionLeafLayoutError(
			`Grid region ${regionId} requires an ungrouped node for its outer incident.`,
		);
	const cellId = defined(context.model.leafByEndpointId.get(endpointId));
	const cell = defined(context.model.regionsById.get(cellId));
	if (cell.parentId !== regionId || cell.definition.lanePresentation !== undefined)
		throw new UnsupportedRegionLeafLayoutError(
			`Grid region ${regionId} requires an ordinary cell for its outer incident.`,
		);
	return { relationId, endpointId, cellId, source, side };
}

function gridCellInput(context: RecursiveContext, regionId: string): GridCellInput {
	const region = defined(context.model.regionsById.get(regionId));
	const grid = defined(region.definition.grid);
	const childIds = new Set(region.childIds);
	const crossings = defined(context.model.crossingRelationsByOwner.get(regionId));
	if (childIds.size !== 4 || grid.cells.some(({ regionId: id }) => !childIds.has(id)))
		throw new UnsupportedRegionLeafLayoutError(`Region ${regionId} has an invalid grid cell set.`);
	const cells = grid.cells.map((cell) => {
		const { regionId: id, row, column } = cell;
		const child = defined(context.model.regionsById.get(id));
		if (child.childIds.length > 0)
			throw new UnsupportedRegionLeafLayoutError(
				`Grid cell ${id} must use an ordinary leaf layout in this bounded policy.`,
			);
		const incidentFailure = laneCellIncidentFailure({
			graph: context.graph,
			model: context.model,
			gridId: regionId,
			cell,
			crossings,
		});
		if (incidentFailure !== undefined) throw new UnsupportedRegionLeafLayoutError(incidentFailure);
		const base = { id, parentId: regionId, row, column };
		if (child.definition.layout === undefined) return base;
		return { ...base, layout: child.definition.layout };
	});
	const cellByEndpointId = new Map(
		[...context.model.leafByEndpointId].filter(([, leafId]) => childIds.has(leafId)),
	);
	return {
		rootId: regionId,
		cells,
		cellByEndpointId,
		minimumColumnWidths: grid.minimumColumnWidths,
		minimumRowHeights: grid.minimumRowHeights,
	};
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

type SolveChild = (
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
) => SolvedRecursiveRegion;

interface SolvedGrid {
	readonly selected: GridCellSelected;
	readonly children: ReadonlyMap<string, SolvedRecursiveRegion>;
}

function childSide(side: NestedPortalSide): NestedPortalSide {
	if (side === NestedPortalSide.Top) return NestedPortalSide.Bottom;
	return NestedPortalSide.Top;
}

function withOuterCellIncident(
	cellId: string,
	incident: ExternalGridIncident,
	solved: SolvedRecursiveRegion,
): SolvedRecursiveRegion {
	const original = defined(solved.incidentPaths.get(incident.relationId));
	const piece = defined(original.pieces[0]);
	let anchor = defined(piece.points.at(-1));
	if (incident.source) anchor = defined(piece.points[0]);
	const leftmost = Math.min(...solved.layout.elements.map(({ bounds }) => bounds.x));
	// A reserved route in the leaf margin can pass beside local nodes and routes.
	const corridorX = Math.max(-LEAF_DETOUR_CLEARANCE, leftmost - LEAF_DETOUR_CLEARANCE);
	const portal = boundaryPortal({
		relationId: incident.relationId,
		endpointId: incident.endpointId,
		regionId: cellId,
		side: childSide(incident.side),
		x: corridorX,
		canvasHeight: solved.layout.height,
	});
	const bend = { x: corridorX, y: anchor.y };
	let points = [portal.point, bend, anchor];
	if (incident.source) points = [anchor, bend, portal.point];
	const path: RegionIncidentPath = {
		relationId: incident.relationId,
		endpointId: incident.endpointId,
		pieces: [{ relationId: incident.relationId, regionId: cellId, points }],
		portals: [portal],
	};
	return {
		...solved,
		incidentPaths: new Map([...solved.incidentPaths, [incident.relationId, path]]),
	};
}

function selectedGrid(
	context: RecursiveContext,
	regionId: string,
	incidents: readonly ExternalGridIncident[],
	solveChild: SolveChild,
): SolvedGrid {
	const input = gridCellInput(context, regionId);
	const document = localGridDocument(context, input);
	const graph = createGraph(document);
	if (!graph.ok)
		throw new UnsupportedRegionLeafLayoutError(
			`Grid region ${regionId} has an invalid local graph.`,
		);
	const grid = normalize(graph.value, input);
	if (typeof grid === 'string') throw new UnsupportedRegionLeafLayoutError(grid);
	const crossing = defined(context.model.crossingRelationsByOwner.get(regionId));
	const metricDemands = crossingMetricDemands(crossingIncidence(crossing));
	const measurements = satisfyMetricDemands(
		context.measurements,
		metricDemands,
		document.layout.direction,
	);
	const childContext = { ...context, measurements };
	const solvedById = new Map<string, SolvedRecursiveRegion>();
	const incidentByCell = new Map(incidents.map((incident) => [incident.cellId, incident]));
	const children = grid.cells.map((cell) => {
		const incident = incidentByCell.get(cell.id);
		const sides = new Map<string, NestedPortalSide>();
		if (incident?.cellId === cell.id) sides.set(incident.relationId, childSide(incident.side));
		const contract = laneCellOutgoingContract({
			graph: context.graph,
			model: context.model,
			gridId: regionId,
			cell: { regionId: cell.id, row: cell.row, column: cell.column },
			crossings: crossing,
		});
		let solved: SolvedRecursiveRegion;
		if (contract === undefined) solved = solveChild(childContext, cell.id, sides);
		else solved = solveContractedLaneCell(childContext, cell.id, contract);
		if (incident?.cellId === cell.id) solved = withOuterCellIncident(cell.id, incident, solved);
		solvedById.set(cell.id, solved);
		return { cell, layout: solved.layout, ranks: solved.ranks };
	});
	const attempt = composeGridCellDisposition(graph.value, input, context.model, children);
	if (attempt.status === GridCellLayoutStatus.Unsupported)
		throw new UnsupportedRegionLeafLayoutError(attempt.reason);
	if (attempt.status === GridCellLayoutStatus.Unknown)
		throw new UnknownRegionLeafLayoutError(attempt.reason);
	return { selected: attempt, children: solvedById };
}

function routeById(selected: GridCellSelected): ReadonlyMap<string, LayoutRelation> {
	return new Map(selected.layout.relations.map((route) => [route.id, route]));
}

function nestedPortals(selected: GridCellSelected): readonly NestedRegionPortal[] {
	return selected.portals.map((portal) => {
		let side = NestedPortalSide.Left;
		if (portal.side === GridCellSide.Right) side = NestedPortalSide.Right;
		return { ...portal, side };
	});
}

function ownedGridRoutes(
	context: RecursiveContext,
	regionId: string,
	selected: GridCellSelected,
): readonly NestedOwnedRoute[] {
	const routes = routeById(selected);
	const owned: NestedOwnedRoute[] = [];
	for (const cell of selected.cells)
		for (const relation of defined(context.model.localRelationsByOwner.get(cell.id))) {
			const route = defined(routes.get(relation.id));
			owned.push({
				relationId: relation.id,
				regionId: cell.id,
				points: route.points,
			});
		}
	for (const relation of defined(context.model.crossingRelationsByOwner.get(regionId))) {
		const route = defined(routes.get(relation.id));
		const sourceCellId = defined(context.model.leafByEndpointId.get(relation.from));
		const targetCellId = defined(context.model.leafByEndpointId.get(relation.to));
		owned.push(
			{
				relationId: relation.id,
				regionId: sourceCellId,
				points: route.points.slice(0, 2),
			},
			{ relationId: relation.id, regionId, points: route.points.slice(1, -1) },
			{
				relationId: relation.id,
				regionId: targetCellId,
				points: route.points.slice(-2),
			},
		);
	}
	return owned;
}

/** Embed the bounded grid policy as a region disposition with disjoint outer incidents. */
export function solveGridCellRecursiveRegion(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
	solveChild: SolveChild,
): SolvedRecursiveRegion {
	const incidents = externalIncidents(context, regionId, incidentSides);
	const grid = selectedGrid(context, regionId, incidents, solveChild);
	const { selected } = grid;
	const incidentPaths = new Map<string, RegionIncidentPath>();
	for (const incident of incidents)
		incidentPaths.set(
			incident.relationId,
			outerGridIncidentPath(incident, regionId, selected, grid.children),
		);
	return {
		layout: selected.layout,
		ranks: { bands: [], byEndpointId: new Map() },
		regions: selected.cells,
		portals: nestedPortals(selected),
		ownedRoutes: ownedGridRoutes(context, regionId, selected),
		incidentPaths,
	};
}
