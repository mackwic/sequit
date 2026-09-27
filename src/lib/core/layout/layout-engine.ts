import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { buildLayoutResult } from './build-layout-result';
import { createLayoutFrame } from './geometry/layout-frame';
import { inspectRouting } from './inspection/routing-inspection';
import { placeWithPorts, portsChangePlacement, withChainAlignment } from './layout-port-placement';
import type {
	DedicatedLayoutEvaluation,
	LayoutMeasurements,
	LayoutOptions,
	LayoutResult,
	Point,
	RoutingLayers,
} from './layout-types';
import type { LayoutWorkspace } from './layout-workspace';
import { alignBypassedChains } from './placement/bypassed-chain-alignment';
import { expandRowGaps } from './placement/expand-row-gaps';
import { groupJunctionInsets } from './placement/group-junction-channels';
import { placeElements } from './placement/place-elements';
import { prepareMeasurements } from './placement/prepare-measurements';
import type { RankOrderSearchWitness } from './rank/rank-order-search';
import { selectDedicatedRankLayout } from './rank/rank-order-selection';
import { alignJunctionPorts } from './routing/align-junction-ports';
import { allocateLayerPorts } from './routing/layered-port-reservation';
import { materializeLayers, planLayeredRouting } from './routing/layered-routing';
import { allocatePorts, type PortAllocation } from './routing/port-allocation';
import { planNodeRouting, type NodeRouting } from './routing/reserve-node-routing';
import { improvesRoutes } from './routing/route-cost';
import {
	cornerPortSharing,
	crossingCorridors,
	type RoutingCorridor,
} from './routing/routing-corridors';
import { directRoutingSpace, routingSpace } from './routing/routing-space';
import { settleGroupCorridorPorts } from './routing/settle-group-corridors';
import { bypassedChains } from './structure/bypassed-chains';
import type { LayoutStructure } from './structure/prepare-layout';
import { routingLayers } from './structure/routing-layers';

interface RoutingReservation {
	readonly gaps: ReadonlyMap<number, number>;
	readonly channelGaps?: ReadonlyMap<number, readonly number[]>;
}

interface LayeredRoutingResult {
	readonly materialize: () => ReadonlyMap<string, readonly Point[]>;
	readonly reservation: RoutingReservation;
}

function mergeGapMaps(
	left: ReadonlyMap<number, number>,
	right: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
	const result = new Map(left);
	for (const [rank, gap] of right) result.set(rank, Math.max(result.get(rank) ?? 0, gap));
	return result;
}

function mergeChannelGapMaps(
	left: ReadonlyMap<number, readonly number[]> | undefined,
	right: ReadonlyMap<number, readonly number[]> | undefined,
): ReadonlyMap<number, readonly number[]> | undefined {
	if (left === undefined) return right;
	if (right === undefined) return left;
	const result = new Map(left);
	for (const [rank, gaps] of right) {
		const current = result.get(rank) ?? [];
		result.set(
			rank,
			Array.from({ length: Math.max(current.length, gaps.length) }, (_, index) =>
				Math.max(current[index] ?? 0, gaps[index] ?? 0),
			),
		);
	}
	return result;
}

function mergeReservations(
	left: RoutingReservation,
	right: RoutingReservation,
): RoutingReservation {
	return {
		gaps: mergeGapMaps(left.gaps, right.gaps),
		channelGaps: mergeChannelGapMaps(left.channelGaps, right.channelGaps),
	};
}

function structureForComponents(
	structure: LayoutStructure,
	components: LayoutStructure['components'],
): LayoutStructure {
	const ids = new Set(components.flatMap(({ ids: componentIds }) => componentIds));
	const relations = structure.graph.relations.filter(
		({ relation }) => ids.has(relation.from) && ids.has(relation.to),
	);
	const relationIds = new Set(relations.map(({ relation }) => relation.id));
	const graph: LogicGraph = {
		...structure.graph,
		endpointsById: structure.graph.endpointsById,
		relations,
		effectiveRelations: structure.graph.effectiveRelations.filter(({ relationId }) =>
			relationIds.has(relationId),
		),
		rankableEndpointIds: structure.graph.rankableEndpointIds.filter((id) => ids.has(id)),
		outgoingByEndpointId: new Map(
			[...structure.graph.outgoingByEndpointId]
				.filter(([id]) => ids.has(id))
				.map(([id, neighbors]) => [id, neighbors.filter((neighbor) => ids.has(neighbor))]),
		),
		predecessorsByEndpointId: new Map(
			[...structure.graph.predecessorsByEndpointId]
				.filter(([id]) => ids.has(id))
				.map(([id, neighbors]) => [id, neighbors.filter((neighbor) => ids.has(neighbor))]),
		),
	};
	const hasGroupContext = [...ids].some(
		(id) =>
			structure.hierarchy?.byId.has(id) === true ||
			structure.graph.endpointsById.get(id)?.entity.groupId !== undefined,
	);
	return {
		...structure,
		graph,
		junctionIds: new Set([...structure.junctionIds].filter((id) => ids.has(id))),
		junctions: new Map([...structure.junctions].filter(([id]) => ids.has(id))),
		branchAnchors: new Map(
			[...structure.branchAnchors].filter(([, anchor]) => relationIds.has(anchor.relationId)),
		),
		hierarchy: hasGroupContext ? structure.hierarchy : undefined,
		components,
	};
}

function usesLayeredRouting(
	structure: LayoutStructure,
	component: LayoutStructure['components'][number],
): boolean {
	if (structure.maximumRank <= 1 && structure.junctionIds.size === 0) return false;
	const ids = new Set(component.ids);
	if (component.ids.some((id) => structure.junctionIds.has(id))) return true;
	return structure.graph.relations.some(({ relation }) => {
		if (!ids.has(relation.from) || !ids.has(relation.to)) return false;
		const sourceRank = defined(structure.ranks.byEndpointId.get(relation.from));
		const targetRank = defined(structure.ranks.byEndpointId.get(relation.to));
		return sourceRank > targetRank + 1;
	});
}

function scopePortAllocation(ports: PortAllocation, structure: LayoutStructure): PortAllocation {
	const relationIds = new Set(structure.graph.relations.map(({ relation }) => relation.id));
	const endpointIds = new Set(structure.graph.rankableEndpointIds);
	return {
		...ports,
		sourceOffsets: new Map([...ports.sourceOffsets].filter(([id]) => relationIds.has(id))),
		targetOffsets: new Map([...ports.targetOffsets].filter(([id]) => relationIds.has(id))),
		metricDemands: ports.metricDemands.filter(({ endpointId }) => endpointIds.has(endpointId)),
		sizes: new Map([...ports.sizes].filter(([id]) => endpointIds.has(id))),
	};
}

function placeWithRoutingPorts(
	workspace: LayoutWorkspace,
	ports: PortAllocation,
	routingStructure: LayoutStructure,
	reservation?: RoutingReservation,
): void {
	if (routingStructure === workspace.structure) {
		placeWithPorts(workspace, ports, reservation);
		return;
	}
	const relationIds = new Set(routingStructure.graph.relations.map(({ relation }) => relation.id));
	const offsets = new Map(workspace.placement.branchOffsets ?? []);
	for (const [id, anchor] of workspace.structure.branchAnchors) {
		if (!relationIds.has(anchor.relationId)) continue;
		offsets.set(
			id,
			(ports.targetOffsets.get(anchor.relationId) ?? 0) -
				(ports.sourceOffsets.get(anchor.relationId) ?? 0),
		);
	}
	workspace.placement.branchOffsets = offsets;
	for (const [id, size] of ports.sizes) workspace.measurements.sizes.set(id, size);
	placeElements(workspace, reservation?.gaps ?? new Map(), reservation?.channelGaps);
}

function componentPortsChangePlacement(
	workspace: LayoutWorkspace,
	ports: PortAllocation,
	routingStructure: LayoutStructure,
): boolean {
	if (routingStructure === workspace.structure) return portsChangePlacement(workspace, ports);
	const { frame, measurements, placement } = workspace;
	for (const demand of ports.metricDemands) {
		const size = defined(measurements.sizes.get(demand.endpointId));
		if (frame.vertical && size.width < demand.minimumCrossSize) return true;
		if (!frame.vertical && size.height < demand.minimumCrossSize) return true;
	}
	for (const [id, anchor] of routingStructure.branchAnchors) {
		const offset =
			(ports.targetOffsets.get(anchor.relationId) ?? 0) -
			(ports.sourceOffsets.get(anchor.relationId) ?? 0);
		if (offset !== (placement.branchOffsets?.get(id) ?? 0)) return true;
	}
	return false;
}

function reserveLayeredRouting(
	workspace: LayoutWorkspace,
	layers: RoutingLayers,
	routingStructure: LayoutStructure = workspace.structure,
	baseReservation: RoutingReservation = { gaps: new Map() },
): LayeredRoutingResult | undefined {
	const { measurements, placement, frame } = workspace;
	const structure = routingStructure;
	if (structure.junctionIds.size === 0 && structure.maximumRank <= 1) return undefined;
	const skipsOrdinaryRows =
		structure.junctionIds.size === 0 &&
		structure.graph.relations.some(({ relation }) => {
			const sourceRank = defined(structure.ranks.byEndpointId.get(relation.from));
			const targetRank = defined(structure.ranks.byEndpointId.get(relation.to));
			return sourceRank > targetRank + 1;
		});
	if (structure.junctionIds.size === 0 && !skipsOrdinaryRows) return undefined;
	const alignment = alignBypassedChains(
		bypassedChains(structure.graph, structure.components, structure.ranks.byEndpointId),
		measurements.sizes,
		frame.vertical,
	);
	const input = {
		graph: structure.graph,
		layers,
		bounds: placement.bounds,
		frame,
		ranks: structure.ranks.byEndpointId,
		junctionIds: structure.junctionIds,
		sizes: measurements.sizes,
		componentByEndpointId: new Map(
			workspace.structure.components.flatMap((component, index) =>
				component.ids.map((id) => [id, index] as const),
			),
		),
	};
	const allocated = allocateLayerPorts({
		forceChannels: routingStructure !== workspace.structure,
		...input,
		space: directRoutingSpace({
			layers,
			bounds: placement.bounds,
			frame,
			junctionIds: structure.junctionIds,
			enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
		}),
	});
	if (allocated === undefined) return undefined;
	let ports =
		routingStructure === workspace.structure
			? allocated
			: scopePortAllocation(allocated, structure);
	if (routingStructure === workspace.structure) placement.transverseCenters = alignment?.centers;
	else if (alignment !== undefined) {
		const centers = new Map(placement.transverseCenters ?? []);
		for (const [id, center] of alignment.centers) centers.set(id, center);
		placement.transverseCenters = centers;
	}
	ports = withChainAlignment(ports, alignment);
	if (routingStructure !== workspace.structure) ports = scopePortAllocation(ports, structure);
	const initialReservation =
		routingStructure === workspace.structure
			? { gaps: new Map<number, number>() }
			: baseReservation;
	placeWithRoutingPorts(workspace, ports, structure, initialReservation);
	let plan = planLayeredRouting(input, ports);
	let reservation: RoutingReservation =
		routingStructure === workspace.structure ? plan : mergeReservations(baseReservation, plan);
	const planReservation = routingStructure === workspace.structure ? plan : reservation;
	placeWithRoutingPorts(workspace, ports, structure, planReservation);
	if (structure.junctionIds.size > 0) {
		const originalPorts = ports;
		const originalPlan = plan;
		const originalReservation = reservation;
		const originalPaths = materializeLayers(input, plan);
		let proposal = alignJunctionPorts({
			...input,
			vertical: frame.vertical,
			ports,
		});
		if (routingStructure !== workspace.structure)
			proposal = scopePortAllocation(proposal, structure);
		placeWithRoutingPorts(workspace, proposal, structure, planReservation);
		ports = alignJunctionPorts({
			...input,
			vertical: frame.vertical,
			ports: originalPorts,
		});
		if (routingStructure !== workspace.structure) ports = scopePortAllocation(ports, structure);
		plan = planLayeredRouting(input, ports);
		reservation =
			routingStructure === workspace.structure ? plan : mergeReservations(baseReservation, plan);
		placeWithRoutingPorts(
			workspace,
			ports,
			structure,
			routingStructure === workspace.structure ? plan : reservation,
		);
		const fits = [...ports.sizes].every(([id, size]) => {
			const placed = proposal.sizes.get(id);
			return placed?.width === size.width && placed.height === size.height;
		});
		if (!fits || !improvesRoutes(originalPaths, materializeLayers(input, plan))) {
			ports = originalPorts;
			plan = originalPlan;
			reservation = originalReservation;
			placeWithRoutingPorts(
				workspace,
				ports,
				structure,
				routingStructure === workspace.structure ? plan : reservation,
			);
		}
	}
	workspace.routing = {
		ports,
		gaps: reservation.gaps,
		ranks: structure.ranks.byEndpointId,
		corridors: [],
		railCounts: new Map(),
	};
	return { materialize: () => materializeLayers(input, plan), reservation };
}

function reserveRouting(
	workspace: LayoutWorkspace,
	baseGaps: ReadonlyMap<number, number>,
	routingStructure: LayoutStructure = workspace.structure,
): void {
	const { measurements, frame, placement } = workspace;
	const { graph, ranks } = routingStructure;
	let corridors: readonly RoutingCorridor[] = crossingCorridors({
		graph,
		ranks: ranks.byEndpointId,
		bounds: placement.bounds,
		vertical: frame.vertical,
	});
	if (corridors.length === 0) return;
	const sharing = cornerPortSharing(corridors);
	const allocated = allocatePorts({
		corridors,
		...sharing,
		fromCrossingCorridors: true,
		sizes: measurements.sizes,
		vertical: frame.vertical,
		graph,
		bounds: placement.bounds,
	});
	let ports =
		routingStructure === workspace.structure
			? allocated
			: scopePortAllocation(allocated, routingStructure);
	let reusePlacement = sharing !== undefined && routingStructure.hierarchy === undefined;
	if (reusePlacement && routingStructure.junctionIds.size === 0)
		reusePlacement = !componentPortsChangePlacement(workspace, ports, routingStructure);
	if (!reusePlacement)
		placeWithRoutingPorts(workspace, ports, routingStructure, { gaps: baseGaps });
	if (routingStructure.hierarchy !== undefined)
		({ corridors, ports } = settleGroupCorridorPorts({
			graph,
			ranks: ranks.byEndpointId,
			bounds: placement.bounds,
			vertical: frame.vertical,
			sizes: measurements.sizes,
			initial: corridors,
			initialPorts: ports,
			place: (candidate) => {
				const selected =
					routingStructure === workspace.structure
						? candidate
						: scopePortAllocation(candidate, routingStructure);
				placeWithRoutingPorts(workspace, selected, routingStructure, { gaps: baseGaps });
			},
		}));
	if (routingStructure !== workspace.structure)
		ports = scopePortAllocation(ports, routingStructure);
	const routing = planNodeRouting({
		corridors,
		ports,
		bounds: placement.bounds,
		vertical: frame.vertical,
		ranks: ranks.byEndpointId,
		reuseCorridorCenters: reusePlacement,
	});
	if (routingStructure.hierarchy === undefined && routingStructure.junctionIds.size === 0) {
		workspace.routing = routing;
		if (routingStructure !== workspace.structure) {
			placeWithRoutingPorts(workspace, ports, routingStructure, {
				gaps: mergeGapMaps(baseGaps, routing.gaps),
			});
		} else
			expandRowGaps({
				bounds: placement.bounds,
				ranks: ranks.byEndpointId,
				gaps: routing.gaps,
				maximumRank: routingStructure.maximumRank,
				frame,
			});
		return;
	}
	placeWithRoutingPorts(workspace, ports, routingStructure, routing);
	workspace.routing = routing;
}

interface StandardRoutingPlan {
	readonly structure: LayoutStructure;
	readonly routing: NodeRouting | undefined;
}

function materializeStandardRoutes(
	workspace: LayoutWorkspace,
	plan: StandardRoutingPlan,
): ReadonlyMap<string, readonly Point[]> {
	const { frame, placement } = workspace;
	const { structure, routing } = plan;
	const placedRouting =
		routing === undefined || routing.corridors.length === 0
			? routing
			: planNodeRouting({
					corridors: routing.corridors.map(({ corridor }) => corridor),
					ports: routing.ports,
					bounds: placement.bounds,
					vertical: frame.vertical,
					ranks: structure.ranks.byEndpointId,
				});
	const result = buildLayoutResult({
		graph: structure.graph,
		bounds: placement.bounds,
		routing: placedRouting,
		frame,
		space: routingSpace({
			layers: routingLayers(structure),
			bounds: placement.bounds,
			frame,
			enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
		}),
	});
	return new Map(result.relations.map(({ id, points }) => [id, points]));
}

function reserveMixedRouting(
	workspace: LayoutWorkspace,
	baseGaps: ReadonlyMap<number, number>,
	layeredComponents: LayoutStructure['components'],
	normalComponents: LayoutStructure['components'],
): ReadonlyMap<string, readonly Point[]> {
	let reservation: RoutingReservation = { gaps: baseGaps };
	const standardPlans: StandardRoutingPlan[] = [];
	let inspectionPlan: NodeRouting | undefined;
	const sourceOffsets = new Map<string, number>();
	const targetOffsets = new Map<string, number>();
	const rememberPorts = (plan: NodeRouting): void => {
		inspectionPlan = plan;
		for (const [id, offset] of plan.ports.sourceOffsets) sourceOffsets.set(id, offset);
		for (const [id, offset] of plan.ports.targetOffsets) targetOffsets.set(id, offset);
	};
	for (const component of normalComponents) {
		const componentStructure = structureForComponents(workspace.structure, [component]);
		workspace.routing = undefined;
		reserveRouting(workspace, reservation.gaps, componentStructure);
		const routing = workspace.routing;
		standardPlans.push({ structure: componentStructure, routing });
		if (routing !== undefined) {
			rememberPorts(routing);
			reservation = mergeReservations(reservation, { gaps: routing.gaps });
		}
	}
	const layeredPlans: LayeredRoutingResult[] = [];
	for (const component of layeredComponents) {
		const componentStructure = structureForComponents(workspace.structure, [component]);
		const layered = reserveLayeredRouting(
			workspace,
			routingLayers(componentStructure),
			componentStructure,
			reservation,
		);
		if (layered === undefined) continue;
		layeredPlans.push(layered);
		reservation = layered.reservation;
		if (workspace.routing !== undefined) rememberPorts(workspace.routing);
	}
	const routes = new Map<string, readonly Point[]>();
	for (const plan of standardPlans)
		for (const [id, points] of materializeStandardRoutes(workspace, plan)) routes.set(id, points);
	for (const { materialize } of layeredPlans)
		for (const [id, points] of materialize()) routes.set(id, points);
	workspace.routing =
		inspectionPlan === undefined
			? undefined
			: {
					...inspectionPlan,
					ports: { ...inspectionPlan.ports, sourceOffsets, targetOffsets },
					gaps: reservation.gaps,
					corridors: [],
				};
	return routes;
}

export function evaluateDedicatedLayout(
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	options?: LayoutOptions,
): LayoutResult;
export function evaluateDedicatedLayout(
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	options: LayoutOptions | undefined,
	retainForCompletion: true,
): DedicatedLayoutEvaluation;
export function evaluateDedicatedLayout(
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
	retainForCompletion = false,
): LayoutResult | DedicatedLayoutEvaluation {
	const graph = structure.graph;
	const ranks = structure.ranks;
	const frame = createLayoutFrame(graph.document.layout.direction, graph.document.layout.bias);
	const workspace: LayoutWorkspace = {
		structure,
		frame,
		measurements: prepareMeasurements(structure, measurements, frame),
		placement: {
			bounds: new Map(),
			components: [],
			groupChannelInsets: new Map(),
		},
		routing: undefined,
	};
	const baseGaps = new Map<number, number>();
	placeElements(workspace, baseGaps);
	workspace.placement.groupChannelInsets = groupJunctionInsets(
		structure,
		workspace.placement.bounds,
		frame,
	);
	if (workspace.placement.groupChannelInsets.size > 0) {
		delete workspace.placement.groupWindows;
		placeElements(workspace, baseGaps);
	}
	const layers = routingLayers(structure);
	const layeredComponents = structure.components.filter((component) =>
		usesLayeredRouting(structure, component),
	);
	const normalComponents = structure.components.filter(
		(component) => !usesLayeredRouting(structure, component),
	);
	let routes: ReadonlyMap<string, readonly Point[]> | undefined;
	if (layeredComponents.length === 0) reserveRouting(workspace, baseGaps);
	else if (normalComponents.length === 0) {
		const layered = reserveLayeredRouting(workspace, layers);
		if (layered === undefined) reserveRouting(workspace, baseGaps);
		else routes = layered.materialize();
	} else {
		routes = reserveMixedRouting(workspace, baseGaps, layeredComponents, normalComponents);
	}
	const space = routingSpace({
		layers,
		bounds: workspace.placement.bounds,
		frame,
		enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
	});
	const result = buildLayoutResult({
		graph,
		bounds: workspace.placement.bounds,
		routing: workspace.routing,
		frame,
		routes,
		space,
	});
	if (options.inspectRouting !== true) {
		if (!retainForCompletion) return result;
		return { result, complete: () => result };
	}
	const inspectionInput = {
		layout: result,
		measurements,
		ranks: ranks.byEndpointId,
		direction: frame.direction,
		plan: workspace.routing,
	};
	if (!retainForCompletion)
		return { ...result, routingInspection: inspectRouting(inspectionInput) };
	return {
		result,
		complete: () => ({
			...result,
			routingInspection: inspectRouting(inspectionInput),
		}),
	};
}

export function layoutWithDedicatedEngine(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
): LayoutResult {
	return selectDedicatedRankLayout(graph, ranks, measurements, {
		options,
		evaluate: evaluateDedicatedLayout,
	}).layout;
}

/** The same production selection, exposing its transient proof to workshop consumers. */
export function layoutWithDedicatedEngineAndRankOrderWitness(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
): { readonly layout: LayoutResult; readonly witness: RankOrderSearchWitness } {
	return selectDedicatedRankLayout(graph, ranks, measurements, {
		options,
		evaluate: evaluateDedicatedLayout,
	});
}
