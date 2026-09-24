import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicRelation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { boundedCounter, firstValidDepthFirst } from './bounded-search';
import { satisfyMetricDemands } from './contract/metric-demand';
import {
	crossingIncidence,
	crossingMetricDemands,
	gridMargin,
	gridRoutingEdges,
} from './grid-cell-crossing';
import {
	canonicalCrossingAllocation,
	CROSSING_ALLOCATION_BUDGET,
	crossingAllocationCandidates,
	crossingAllocationCandidatesWithExtraTrack,
	type CrossingAllocationInput,
	type GridCrossingAllocation,
} from './grid-cell-crossing-allocation';
import {
	crossingPortalSpans,
	crossingRoute,
	gridCrossingOwnedRoutes,
	type GridCrossingRouting,
} from './grid-cell-crossing-routing';
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
} from './region-composition-model';
import { diagnoseParentRouteContacts } from './region-composition-validation-detail';
import {
	type RegionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from './region-geometry-diagnostic';
import type { RegionLocalLayoutCache } from './region-local-cache';

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
	const metricDemands = crossingMetricDemands(crossingIncidence(crossing));
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
	const margin = gridMargin(gridRoutingEdges(input.rootId, ownedCrossings(model, input).length));
	const disposition = layoutGridCellDisposition(children, input, margin);
	return routePlacedGridCellDisposition({ graph, input, model, disposition });
}

interface PlacedGridCellInput {
	readonly graph: LogicGraph;
	readonly input: GridCellInput;
	readonly model: RegionCompositionModel;
	readonly disposition: GridCellDisposition;
}

interface RoutedGridCrossing {
	readonly candidate: GridCellSelected;
	readonly failure?: RegionGeometryDiagnostic;
}

function ownedCrossings(
	model: RegionCompositionModel,
	input: GridCellInput,
): readonly LogicRelation[] {
	return model.relations
		.filter(({ kind, ownerId }) => kind === RegionRelationKind.Crossing && ownerId === input.rootId)
		.map(({ relation }) => relation);
}

/** Route a grid whose child placements have already been selected. */
export function routePlacedGridCellDisposition(placed: PlacedGridCellInput): GridCellLayoutAttempt {
	const { graph, input, model, disposition } = placed;
	const crossing = ownedCrossings(model, input);
	const incidence = crossingIncidence(crossing);
	const edges = gridRoutingEdges(input.rootId, crossing.length);
	const { cells, columnWidths, rowHeights, gridRight, gridBottom } = disposition;
	const cellById = new Map(cells.map((cell) => [cell.id, cell]));
	const ownsColumn = (relation: LogicRelation, column: 0 | 1): boolean =>
		[relation.from, relation.to].some(
			(endpointId) =>
				defined(cellById.get(defined(input.cellByEndpointId.get(endpointId)))).column === column,
		);
	const routing: GridCrossingRouting = {
		rootId: input.rootId,
		crossing,
		leftRailIds: crossing.filter((relation) => ownsColumn(relation, 0)).map(({ id }) => id),
		rightRailIds: crossing.filter((relation) => ownsColumn(relation, 1)).map(({ id }) => id),
		cells,
		cellByEndpointId: input.cellByEndpointId,
		gridRight,
		margin: gridMargin(edges),
		edges,
		incidence,
	};
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
	const lanes = cells.flatMap((cell) =>
		(cell.localLayout.lanes ?? []).map((lane) => ({
			...lane,
			bounds: moveBounds(lane.bounds, cell.translation),
		})),
	);
	const routed = (allocation: GridCrossingAllocation): RoutedGridCrossing => {
		const crossingRoutes = crossing.map((relation) => crossingRoute(routing, allocation, relation));
		const routesById = new Map(
			[...localRoutes, ...crossingRoutes.map(({ route }) => route)].map((route) => [
				route.id,
				route,
			]),
		);
		let layout: LayoutResult = {
			width: gridRight + routing.margin,
			height: gridBottom + routing.margin,
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
		if (failure !== undefined) return { candidate, failure };
		const contact = diagnoseParentRouteContacts(
			model,
			gridCrossingOwnedRoutes(input.rootId, input.cellByEndpointId, crossing, routesById),
		);
		if (contact !== undefined) return { candidate, failure: contact };
		return { candidate };
	};
	const crossingIds = crossing.map(({ id }) => id);
	const allocationInput: CrossingAllocationInput = {
		edges,
		crossingIds,
		leftRailIds: routing.leftRailIds,
		rightRailIds: routing.rightRailIds,
		incidence,
		portalByRelationId: new Map(),
	};
	// The containment rule reads the canonical portals, which do not depend on the allocation.
	const canonical = canonicalCrossingAllocation(allocationInput);
	const withSpans: CrossingAllocationInput = {
		...allocationInput,
		portalByRelationId: crossingPortalSpans(routing, canonical),
	};
	let selected: GridCellSelected | undefined;
	const counter = boundedCounter(CROSSING_ALLOCATION_BUDGET);
	const search = (candidates: Iterable<GridCrossingAllocation>): boolean => {
		const result = firstValidDepthFirst<GridCrossingAllocation, RegionGeometryDiagnostic>({
			levels: 1,
			counter,
			// The declared list is the only level: the search evaluates it in order.
			choices: () => candidates,
			accept: (_, allocation) => {
				const attempt = routed(allocation);
				if (attempt.failure === undefined) selected = attempt.candidate;
				return attempt.failure;
			},
			onReject: () => undefined,
		});
		return result.exhaustive;
	};
	const reallocated = search(crossingAllocationCandidates(withSpans));
	if (selected === undefined && reallocated)
		search(crossingAllocationCandidatesWithExtraTrack(withSpans));
	if (selected !== undefined) return selected;
	// Nothing validates: keep the canonical allocation and today's diagnostic, so the composition
	// validator reports the contact that no reallocation resolved.
	const fallback = routed(canonical);
	if (
		fallback.failure !== undefined &&
		fallback.failure.code !== RegionGeometryDiagnosticCode.ParentRouteContact
	)
		return unknown(fallback.failure.message, fallback.failure.code);
	return fallback.candidate;
}
