import { buildLayoutResult } from './build-layout-result';
import {
	componentPortsChangePlacement,
	type LayoutRoutingWorkspace,
	mergeReservations,
	placeWithRoutingPorts,
	type RoutingReservation,
	scopePortAllocation,
	structureForComponents,
} from './layout-routing-components';
import { type LayeredRoutingResult, reserveLayeredRouting } from './layout-routing-layers';
import type { Point } from './layout-types';
import { expandRowGaps } from './placement/expand-row-gaps';
import { mergeGapMaps } from './placement/place-elements';
import { shellChannelGaps } from './routing/group-shells';
import { allocatePorts } from './routing/port-allocation';
import { type NodeRouting, planNodeRouting } from './routing/reserve-node-routing';
import {
	cornerPortSharing,
	crossingCorridors,
	type RoutingCorridor,
} from './routing/routing-corridors';
import { routingSpace } from './routing/routing-space';
import { settleGroupCorridorPorts } from './routing/settle-group-corridors';
import type { LayoutStructure } from './structure/prepare-layout';
import { routingLayers } from './structure/routing-layers';
export function reserveRouting(
	workspace: LayoutRoutingWorkspace,
	baseGaps: ReadonlyMap<number, number>,
	routingStructure: LayoutStructure = workspace.structure,
): NodeRouting | undefined {
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
	let ports = allocated;
	if (routingStructure !== workspace.structure)
		ports = scopePortAllocation(allocated, routingStructure);
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
				let selected = candidate;
				if (routingStructure !== workspace.structure)
					selected = scopePortAllocation(candidate, routingStructure);
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
		channels: workspace.channels,
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
		return routing;
	}
	const frameIds = new Set(routingStructure.hierarchy?.membersById.keys());
	const framed = {
		...routing,
		gaps: shellChannelGaps({
			gaps: routing.gaps,
			railCounts: routing.railCounts,
			ranks: ranks.byEndpointId,
			bounds: placement.bounds,
			frameIds,
			junctionIds: routingStructure.junctionIds,
			vertical: frame.vertical,
		}),
	};
	placeWithRoutingPorts(workspace, ports, routingStructure, framed);
	workspace.routing = framed;
	return framed;
}

interface StandardRoutingPlan {
	readonly structure: LayoutStructure;
	readonly routing: NodeRouting | undefined;
}

function materializeStandardRoutes(
	workspace: LayoutRoutingWorkspace,
	plan: StandardRoutingPlan,
): ReadonlyMap<string, readonly Point[]> {
	const { frame, placement } = workspace;
	const { structure, routing } = plan;
	let placedRouting = routing;
	if (routing !== undefined && routing.corridors.length > 0)
		placedRouting = planNodeRouting({
			corridors: routing.corridors.map(({ corridor }) => corridor),
			ports: routing.ports,
			bounds: placement.bounds,
			vertical: frame.vertical,
			ranks: structure.ranks.byEndpointId,
			channels: workspace.channels,
		});
	const result = buildLayoutResult({
		graph: structure.graph,
		bounds: placement.bounds,
		routing: placedRouting,
		channels: workspace.channels,
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

export function reserveMixedRouting(
	workspace: LayoutRoutingWorkspace,
	baseGaps: ReadonlyMap<number, number>,
	layeredComponents: LayoutStructure['components'],
	normalComponents: LayoutStructure['components'],
): ReadonlyMap<string, readonly Point[]> {
	let reservation: RoutingReservation = { gaps: baseGaps };
	const standardPlans: StandardRoutingPlan[] = [];
	const inspectionPlans: NodeRouting[] = [];
	const sourceOffsets = new Map<string, number>();
	const targetOffsets = new Map<string, number>();
	const rememberPorts = (plan: NodeRouting): void => {
		inspectionPlans.push(plan);
		for (const [id, offset] of plan.ports.sourceOffsets) sourceOffsets.set(id, offset);
		for (const [id, offset] of plan.ports.targetOffsets) targetOffsets.set(id, offset);
	};
	for (const component of normalComponents) {
		const componentStructure = structureForComponents(workspace.structure, [component]);
		workspace.routing = undefined;
		const routing = reserveRouting(workspace, reservation.gaps, componentStructure);
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
		rememberPorts(layered.routing);
	}
	const routes = new Map<string, readonly Point[]>();
	for (const plan of standardPlans)
		for (const [id, points] of materializeStandardRoutes(workspace, plan)) routes.set(id, points);
	for (const { materialize } of layeredPlans)
		for (const [id, points] of materialize()) routes.set(id, points);
	const inspectionPlan = inspectionPlans.at(-1);
	if (inspectionPlan === undefined) workspace.routing = undefined;
	else
		workspace.routing = {
			...inspectionPlan,
			ports: { ...inspectionPlan.ports, sourceOffsets, targetOffsets },
			gaps: reservation.gaps,
			corridors: [],
		};
	return routes;
}
