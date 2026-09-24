import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { satisfyMetricDemands } from './contract/metric-demand';
import {
	CROSSING_SPACING,
	crossingIncidence,
	crossingMargin,
	crossingMetricDemands,
	crossingPortY,
} from './grid-cell-crossing';
import {
	type GridCellDisposition,
	layoutGridCellDisposition,
	type SolvedGridCell,
} from './grid-cell-disposition';
import { normalize } from './grid-cell-model';
import { normalizeGridCellRegionModel } from './grid-cell-region-model';
import { solveGridCellRegionLeaves } from './grid-cell-region-solver';
import {
	type GridCellInput,
	type GridCellLayoutAttempt,
	GridCellLayoutStatus,
	type GridCellPlacement,
	type GridCellPortal,
	type GridCellSelected,
} from './grid-cell-types';
import { validateGridCellGeometryDiagnostic } from './grid-cell-validation';
import type {
	Bounds,
	LayoutElement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
} from './layout-types';
import {
	type RegionCompositionModel,
	RegionCompositionModelStatus,
	RegionRelationKind,
	type RegionRelationOwnership,
} from './region-composition-model';
import { RegionPortalSide } from './region-composition-types';
import type { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';
import type { RegionLocalLayoutCache } from './region-local-cache';

const OUTER_RAIL_OFFSET = 48;
const TOP_BUS_Y = 24;

interface CrossingRouteContext {
	readonly cells: readonly GridCellPlacement[];
	readonly cellByEndpointId: GridCellInput['cellByEndpointId'];
	readonly gridRight: number;
	readonly margin: number;
	readonly index: number;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

function unsupported(reason: string): GridCellLayoutAttempt {
	return { status: GridCellLayoutStatus.Unsupported, reason };
}

function unknown(reason: string, code?: RegionGeometryDiagnosticCode): GridCellLayoutAttempt {
	if (code !== undefined) return { status: GridCellLayoutStatus.Unknown, reason, code };
	return { status: GridCellLayoutStatus.Unknown, reason };
}

function offset(point: Point, delta: Point): Point {
	return { x: point.x + delta.x, y: point.y + delta.y };
}

function moveBounds(bounds: Bounds, delta: Point): Bounds {
	return { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y };
}

function moveRelation(relation: LayoutRelation, delta: Point): LayoutRelation {
	return { ...relation, points: relation.points.map((point) => offset(point, delta)) };
}

function crossingRoute(
	owned: RegionRelationOwnership,
	context: CrossingRouteContext,
): { readonly route: LayoutRelation; readonly portals: readonly [GridCellPortal, GridCellPortal] } {
	const { relation } = owned;
	const { cells, cellByEndpointId, gridRight, margin, index, incidence } = context;
	const sourceCell = defined(cells.find(({ id }) => id === cellByEndpointId.get(relation.from)));
	const targetCell = defined(cells.find(({ id }) => id === cellByEndpointId.get(relation.to)));
	function endpoint(
		cell: GridCellPlacement,
		endpointId: string,
	): { port: Point; portal: GridCellPortal; railX: number } {
		const local = defined(cell.localLayout.elements.find(({ id }) => id === endpointId));
		let side: RegionPortalSide.Left | RegionPortalSide.Right = RegionPortalSide.Left;
		if (cell.column === 1) side = RegionPortalSide.Right;
		let portX = cell.translation.x + local.bounds.x;
		let portalX = cell.bounds.x;
		const railOffset = CROSSING_SPACING * index;
		let railX = margin - OUTER_RAIL_OFFSET - railOffset;
		if (side === RegionPortalSide.Right) {
			portX += local.bounds.width;
			portalX += cell.bounds.width;
			railX = gridRight + OUTER_RAIL_OFFSET + railOffset;
		}
		const globalBounds = moveBounds(local.bounds, cell.translation);
		const port = {
			x: portX,
			y: crossingPortY(globalBounds, endpointId, relation.id, incidence),
		};
		const point = { x: portalX, y: port.y };
		return {
			port,
			portal: {
				relationId: relation.id,
				endpointId,
				cellId: cell.id,
				regionId: cell.id,
				side,
				point,
				localPoint: { x: point.x - cell.bounds.x, y: point.y - cell.bounds.y },
			},
			railX,
		};
	}
	const source = endpoint(sourceCell, relation.from);
	const target = endpoint(targetCell, relation.to);
	const points: Point[] = [source.port, source.portal.point, { x: source.railX, y: source.port.y }];
	if (source.railX === target.railX) {
		points.push({ x: target.railX, y: target.port.y });
	} else {
		points.push(
			{ x: source.railX, y: TOP_BUS_Y + CROSSING_SPACING * index },
			{ x: target.railX, y: TOP_BUS_Y + CROSSING_SPACING * index },
			{ x: target.railX, y: target.port.y },
		);
	}
	points.push(target.portal.point, target.port);
	return {
		route: { id: relation.id, from: relation.from, to: relation.to, points },
		portals: [source.portal, target.portal],
	};
}

/** Bounded root grid proof. Each cell gets an independent graph, rank set, and dedicated layout. */
export function solveGridCellLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: GridCellInput,
	cache?: RegionLocalLayoutCache,
): GridCellLayoutAttempt {
	const grid = normalize(graph, input);
	if (typeof grid === 'string') return unsupported(grid);
	const normalized = normalizeGridCellRegionModel(graph, input, grid);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		return unsupported(normalized.diagnostic.message);
	const { model } = normalized;
	const crossingOwnership = model.relations.filter(
		({ kind, ownerId }) => kind === RegionRelationKind.Crossing && ownerId === model.rootId,
	);
	const crossing = crossingOwnership.map(({ relation }) => relation);
	const incidence = crossingIncidence(crossing);
	const metricDemands = crossingMetricDemands(incidence);
	const demandedMeasurements = satisfyMetricDemands(
		measurements,
		metricDemands,
		graph.document.layout.direction,
	);
	const children = solveGridCellRegionLeaves({
		graph,
		grid,
		model,
		measurements: demandedMeasurements,
		cache,
	});
	if (children === undefined) return unknown('A child graph could not be solved independently.');
	return composeGridCellDisposition(graph, input, model, children);
}

/** Place already solved child leaves and compose the crossings owned by this grid region. */
export function composeGridCellDisposition(
	graph: LogicGraph,
	input: GridCellInput,
	model: RegionCompositionModel,
	children: readonly SolvedGridCell[],
): GridCellLayoutAttempt {
	const crossingOwnership = model.relations.filter(
		({ kind, ownerId }) => kind === RegionRelationKind.Crossing && ownerId === input.rootId,
	);
	const margin = crossingMargin(crossingOwnership.length);
	const disposition = layoutGridCellDisposition(children, input, margin);
	return routePlacedGridCellDisposition({ graph, input, model, disposition });
}

interface PlacedGridCellInput {
	readonly graph: LogicGraph;
	readonly input: GridCellInput;
	readonly model: RegionCompositionModel;
	readonly disposition: GridCellDisposition;
}

/** Route a grid whose child placements have already been selected. */
export function routePlacedGridCellDisposition(placed: PlacedGridCellInput): GridCellLayoutAttempt {
	const { graph, input, model, disposition } = placed;
	const crossingOwnership = model.relations.filter(
		({ kind, ownerId }) => kind === RegionRelationKind.Crossing && ownerId === input.rootId,
	);
	const crossing = crossingOwnership.map(({ relation }) => relation);
	const incidence = crossingIncidence(crossing);
	const margin = crossingMargin(crossing.length);
	const { cells, columnWidths, rowHeights, gridRight, gridBottom } = disposition;
	const elements: LayoutElement[] = cells.flatMap((cell) =>
		cell.localLayout.elements.map((element) => ({
			...element,
			bounds: moveBounds(element.bounds, cell.translation),
		})),
	);
	elements.sort((left, right) => compareCanonicalStrings(left.id, right.id));
	const localRoutes = cells.flatMap((cell) =>
		cell.localLayout.relations.map((relation) => moveRelation(relation, cell.translation)),
	);
	const crossingRoutes = crossingOwnership.map((owned, index) =>
		crossingRoute(owned, {
			cells,
			cellByEndpointId: input.cellByEndpointId,
			gridRight,
			margin,
			index,
			incidence,
		}),
	);
	const routesById = new Map(
		[...localRoutes, ...crossingRoutes.map(({ route }) => route)].map((route) => [route.id, route]),
	);
	const lanes = cells.flatMap((cell) =>
		(cell.localLayout.lanes ?? []).map((lane) => ({
			...lane,
			bounds: moveBounds(lane.bounds, cell.translation),
		})),
	);
	let layout: LayoutResult = {
		width: gridRight + margin,
		height: gridBottom + margin,
		elements,
		relations: graph.relations.map(({ relation }) => defined(routesById.get(relation.id))),
		regions: cells.map(({ id, bounds }) => ({ id, bounds })),
	};
	if (lanes.length > 0) layout = { ...layout, lanes };
	const candidate: GridCellSelected = {
		status: GridCellLayoutStatus.Selected,
		rootId: input.rootId,
		layout,
		cells,
		columnWidths,
		rowHeights,
		portals: crossingRoutes.flatMap(({ portals }) => portals),
	};
	const failure = validateGridCellGeometryDiagnostic(candidate, graph, input);
	if (failure !== undefined) return unknown(failure.message, failure.code);
	return candidate;
}
