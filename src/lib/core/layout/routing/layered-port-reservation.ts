import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { LayoutFrame } from '../geometry/layout-frame';
import type { Bounds, RoutingLayers, Size } from '../layout-types';
import { allocatePorts, type PortAllocation } from './port-allocation';
import { cornerPortSharing, crossingCorridors, type RoutingCorridor } from './routing-corridors';
import { type LayerLink, layerLinks, linkCoordinate } from './routing-layers';
import { directRouteFitsSpace, type DirectRoutingSpace } from './routing-space';

interface ReservationInput {
	readonly graph: LogicGraph;
	readonly layers: RoutingLayers;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly frame: LayoutFrame;
	readonly junctionIds: ReadonlySet<string>;
	readonly ranks: ReadonlyMap<string, number>;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly componentByEndpointId: ReadonlyMap<string, number>;
	readonly space: DirectRoutingSpace;
}

function componentsNeedingDistinctPorts(
	input: ReservationInput,
	crossings: readonly RoutingCorridor[],
	passages: readonly LayerLink[],
): ReadonlySet<number> {
	const routed = new Set<number>();
	for (const id of input.junctionIds) routed.add(defined(input.componentByEndpointId.get(id)));
	for (const corridor of crossings) {
		if (corridor.cornerOnly === true) continue;
		for (const { relation } of corridor.links)
			routed.add(defined(input.componentByEndpointId.get(relation.from)));
	}
	for (const { relation } of passages) {
		const sourceRank = defined(input.ranks.get(relation.from));
		const targetRank = defined(input.ranks.get(relation.to));
		if (sourceRank > targetRank + 1)
			routed.add(defined(input.componentByEndpointId.get(relation.from)));
	}
	return routed;
}

/** Reserve faces before placement; channels are planned from the resulting transverse positions. */
export function allocateLayerPorts(input: ReservationInput): PortAllocation | undefined {
	const { graph, layers, bounds, frame, junctionIds, sizes } = input;
	const crossings = crossingCorridors({
		graph,
		ranks: layers.byId,
		bounds,
		vertical: frame.vertical,
		includeJunctions: true,
	});
	const passages = layerLinks(graph, layers, bounds, {
		vertical: frame.vertical,
	});
	const direct = passages.every(({ relation, sourceLayer, targetLayer }) => {
		if (sourceLayer === targetLayer + 1) return true;
		const sourceRank = defined(input.ranks.get(relation.from));
		const targetRank = defined(input.ranks.get(relation.to));
		if (sourceRank > targetRank + 1) return false;
		if (junctionIds.has(relation.from) || junctionIds.has(relation.to)) return false;
		return directRouteFitsSpace(input.space, relation.from, relation.to);
	});
	if (crossings.length === 0 && direct) {
		// A later ordinary reservation would move the rails and invalidate the direct passages.
		const ordinaryCrossings = crossingCorridors({
			graph,
			ranks: input.ranks,
			bounds,
			vertical: frame.vertical,
		});
		if (ordinaryCrossings.length === 0) return undefined;
	}
	const routedComponents = componentsNeedingDistinctPorts(input, crossings, passages);
	const links = passages.map((link) => {
		const geometry = {
			bounds,
			vertical: frame.vertical,
			offsets: new Map<string, number>(),
		};
		// Order each face by the opposite side of its adjacent channel, including long passages.
		return {
			relation: link.relation,
			source: linkCoordinate(link, true, link.targetLayer + 1, geometry),
			target: linkCoordinate(link, false, link.sourceLayer - 1, geometry),
		};
	});
	const cornerSharing = cornerPortSharing(crossings);
	const sharedSources = new Set(junctionIds);
	for (const id of cornerSharing?.sharedSources ?? [])
		if (!routedComponents.has(defined(input.componentByEndpointId.get(id)))) sharedSources.add(id);
	const sharedTargets = new Set(junctionIds);
	for (const { relation } of passages)
		if (
			!routedComponents.has(defined(input.componentByEndpointId.get(relation.to))) &&
			cornerSharing?.distinctTargets.has(relation.to) !== true
		)
			sharedTargets.add(relation.to);
	return allocatePorts({
		corridors: [{ rank: 0, links }],
		sizes,
		bounds,
		graph,
		vertical: frame.vertical,
		sharedSources,
		sharedTargets,
	});
}
