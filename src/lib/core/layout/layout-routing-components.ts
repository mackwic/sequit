import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { placeWithPorts, portsChangePlacement } from './layout-port-placement';
import { mergeGapMaps, placeElements, type PlacementInput } from './placement/place-elements';
import type { ChannelRoutingCache } from './routing/channel-routing-cache';
import type { PortAllocation } from './routing/port-allocation';
import type { NodeRouting } from './routing/reserve-node-routing';
import type { RankedComponent } from './structure/placement-rows';
import type { LayoutStructure } from './structure/prepare-layout';

/** Routing orchestration extends the placement state without exposing the engine workspace. */
export interface LayoutRoutingWorkspace extends PlacementInput {
	routing: NodeRouting | undefined;
	/** Borrowed from the projection; absent on cold layouts. */
	readonly channels?: ChannelRoutingCache | undefined;
}
export interface RoutingReservation {
	readonly gaps: ReadonlyMap<number, number>;
	readonly channelGaps?: ReadonlyMap<number, readonly number[]>;
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

export function mergeReservations(
	left: RoutingReservation,
	right: RoutingReservation,
): RoutingReservation {
	const gaps = mergeGapMaps(left.gaps, right.gaps);
	const channelGaps = mergeChannelGapMaps(left.channelGaps, right.channelGaps);
	if (channelGaps === undefined) return { gaps };
	return { gaps, channelGaps };
}

export function structureForComponents(
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
	let hierarchy: LayoutStructure['hierarchy'];
	if (hasGroupContext) hierarchy = structure.hierarchy;
	return {
		...structure,
		graph,
		junctionIds: new Set([...structure.junctionIds].filter((id) => ids.has(id))),
		junctions: new Map([...structure.junctions].filter(([id]) => ids.has(id))),
		branchAnchors: new Map(
			[...structure.branchAnchors].filter(([, anchor]) => relationIds.has(anchor.relationId)),
		),
		hierarchy,
		components,
	};
}

/** Components holding a junction or a relation that skips a rank are routed by layers. */
export function layeredRoutingComponents(structure: LayoutStructure): ReadonlySet<RankedComponent> {
	const layered = new Set<RankedComponent>();
	if (structure.maximumRank <= 1 && structure.junctionIds.size === 0) return layered;
	const byEndpoint = new Map<string, RankedComponent>();
	for (const component of structure.components)
		for (const id of component.ids) byEndpoint.set(id, component);
	for (const id of structure.junctionIds) layered.add(defined(byEndpoint.get(id)));
	for (const { relation } of structure.graph.relations) {
		const component = defined(byEndpoint.get(relation.from));
		if (byEndpoint.get(relation.to) !== component) continue;
		const sourceRank = defined(structure.ranks.byEndpointId.get(relation.from));
		const targetRank = defined(structure.ranks.byEndpointId.get(relation.to));
		if (sourceRank > targetRank + 1) layered.add(component);
	}
	return layered;
}

export function scopePortAllocation(
	ports: PortAllocation,
	structure: LayoutStructure,
): PortAllocation {
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

export function placeWithRoutingPorts(
	workspace: LayoutRoutingWorkspace,
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

export function componentPortsChangePlacement(
	workspace: LayoutRoutingWorkspace,
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
