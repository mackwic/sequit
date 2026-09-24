import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicRelation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { boundedCounter, firstValidDepthFirst, type SearchBudgetCounter } from './bounded-search';
import type { RoutedPath } from './bridge-oracle';
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
	type CrossingAllocationInput,
	type CrossingAllocationPhase,
	crossingAllocationPhases,
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
	const margin = gridMargin(
		gridRoutingEdges(
			input.rootId,
			input.minimumColumnWidths.length,
			ownedCrossings(model, input).length,
		),
	);
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
	const { cells, columnWidths, rowHeights, gridRight, gridBottom } = disposition;
	const columnCount = columnWidths.length;
	const edges = gridRoutingEdges(input.rootId, columnCount, crossing.length);
	const margin = gridMargin(edges);
	const cellById = new Map(cells.map((cell) => [cell.id, cell]));
	const gutterIds = Array.from({ length: columnCount }, (_, column) =>
		crossing
			.filter((relation) =>
				[relation.from, relation.to].some(
					(endpointId) =>
						defined(cellById.get(defined(input.cellByEndpointId.get(endpointId)))).column ===
						column,
				),
			)
			.map(({ id }) => id),
	);
	const routing: GridCrossingRouting = {
		rootId: input.rootId,
		crossing,
		columnCount,
		cells,
		cellByEndpointId: input.cellByEndpointId,
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
	const routed = (
		allocation: GridCrossingAllocation,
		acceptBridges: boolean,
	): RoutedGridCrossing => {
		const crossingRoutes = crossing.map((relation) => crossingRoute(routing, allocation, relation));
		const routesById = new Map(
			[...localRoutes, ...crossingRoutes.map(({ route }) => route)].map((route) => [
				route.id,
				route,
			]),
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
		if (failure !== undefined) return { candidate, failure };
		let bridgeRelations: readonly RoutedPath[] = [];
		if (acceptBridges) bridgeRelations = layout.relations;
		const contact = diagnoseParentRouteContacts(
			model,
			gridCrossingOwnedRoutes(input.rootId, input.cellByEndpointId, crossing, routesById),
			bridgeRelations,
		);
		if (contact !== undefined) return { candidate, failure: contact };
		return { candidate };
	};
	const crossingIds = crossing.map(({ id }) => id);
	const allocationInput: CrossingAllocationInput = {
		edges,
		crossingIds,
		gutterIds,
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
	let counter = boundedCounter(CROSSING_ALLOCATION_BUDGET);
	const search = (phase: CrossingAllocationPhase, phaseCounter: SearchBudgetCounter): boolean => {
		const result = firstValidDepthFirst<GridCrossingAllocation, RegionGeometryDiagnostic>({
			levels: 1,
			counter: phaseCounter,
			// The declared list is the only level: the search evaluates it in order.
			choices: () => phase.candidates(withSpans),
			accept: (_, allocation) => {
				const attempt = routed(allocation, phase.acceptBridges);
				if (attempt.failure === undefined) selected = attempt.candidate;
				return attempt.failure;
			},
			onReject: () => undefined,
		});
		return result.exhaustive;
	};
	for (const phase of crossingAllocationPhases(withSpans)) {
		if (!phase.sharesBudget) counter = boundedCounter(CROSSING_ALLOCATION_BUDGET);
		const exhaustive = search(phase, counter);
		if (selected !== undefined || !exhaustive) break;
	}
	if (selected !== undefined) return selected;
	// Nothing validates: keep the canonical allocation and today's diagnostic, so the composition
	// validator reports the contact that no reallocation resolved.
	const fallback = routed(canonical, false);
	if (
		fallback.failure !== undefined &&
		fallback.failure.code !== RegionGeometryDiagnosticCode.ParentRouteContact
	)
		return unknown(fallback.failure.message, fallback.failure.code);
	return fallback.candidate;
}
