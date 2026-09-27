import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { LayoutFrame } from '../geometry/layout-frame';
import type { Bounds, RoutingLayers, Size } from '../layout-types';
import { routePoints } from './endpoint-routes';
import { foreignGroupObstacles } from './group-passages';
import { allocatePorts, type PortAllocation } from './port-allocation';
import { routeHitsObstacles, type RouteObstacles } from './route-obstacles';
import {
	cornerPortSharing,
	type CorridorLink,
	crossingCorridors,
	type RoutingCorridor,
} from './routing-corridors';
import { type LayerLink, layerLinks, linkCoordinate } from './routing-layers';
import { directRouteFitsSpace, directRouteRail, type DirectRoutingSpace } from './routing-space';

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

function sharedTargetsBlockedByForeignGroups(input: ReservationInput): ReadonlySet<string> {
	const { graph, bounds, frame, space } = input;
	const blocked = new Set<string>();
	const passageContext = {
		graph,
		bounds,
		vertical: frame.vertical,
		ancestorCache: new Map<string, readonly string[]>(),
		groupObstacleCache: new Map<string, RouteObstacles | undefined>(),
	};
	for (const entry of graph.relations) {
		if (entry.source.kind !== EndpointKind.Group) continue;
		const predecessors = graph.predecessorsByEndpointId.get(entry.relation.to);
		if (predecessors === undefined || predecessors.length < 2) continue;
		const obstacles = foreignGroupObstacles(passageContext, entry.relation, 0);
		if (obstacles === undefined) continue;
		const source = bounds.get(entry.relation.from);
		const target = bounds.get(entry.relation.to);
		if (source === undefined || target === undefined) continue;
		const points = routePoints({
			source,
			target,
			direction: frame.direction,
			rail: directRouteRail(space, entry.relation.from, entry.relation.to),
		});
		if (routeHitsObstacles(points, obstacles)) blocked.add(entry.relation.to);
	}
	return blocked;
}

function linksForPassages(input: ReservationInput, passages: readonly LayerLink[]): CorridorLink[] {
	const geometry = {
		bounds: input.bounds,
		vertical: input.frame.vertical,
		offsets: new Map<string, number>(),
	};
	return passages.map((link) => ({
		relation: link.relation,
		source: linkCoordinate(link, true, link.targetLayer + 1, geometry),
		target: linkCoordinate(link, false, link.sourceLayer - 1, geometry),
	}));
}

function passagesFitDirectly(input: ReservationInput, passages: readonly LayerLink[]): boolean {
	return passages.every(({ relation, sourceLayer, targetLayer }) => {
		if (sourceLayer === targetLayer + 1) return true;
		const sourceRank = defined(input.ranks.get(relation.from));
		const targetRank = defined(input.ranks.get(relation.to));
		if (sourceRank > targetRank + 1) return false;
		if (input.junctionIds.has(relation.from) || input.junctionIds.has(relation.to)) return false;
		return directRouteFitsSpace(input.space, relation.from, relation.to);
	});
}

function reserveBlockedTargetPorts(
	input: ReservationInput,
	passages: readonly LayerLink[],
	blockedTargets: ReadonlySet<string>,
): PortAllocation {
	const relations = input.graph.relations.filter(({ relation }) => blockedTargets.has(relation.to));
	const links = linksForPassages(
		input,
		passages.filter(({ relation }) => blockedTargets.has(relation.to)),
	);
	const sharedSources = new Set(input.junctionIds);
	for (const { relation } of relations) sharedSources.add(relation.from);
	return allocatePorts({
		corridors: [{ rank: 0, links }],
		sizes: input.sizes,
		bounds: input.bounds,
		graph: { ...input.graph, relations },
		vertical: input.frame.vertical,
		sharedSources,
		sharedTargets: input.junctionIds,
	});
}

function reserveOrdinaryPorts(
	input: ReservationInput,
	crossings: readonly RoutingCorridor[],
	passages: readonly LayerLink[],
): PortAllocation {
	const { graph, bounds, frame, junctionIds, sizes } = input;
	const routedComponents = componentsNeedingDistinctPorts(input, crossings, passages);
	const links = linksForPassages(input, passages);
	const cornerSharing = cornerPortSharing(crossings);
	const sharedSources = new Set(junctionIds);
	for (const id of cornerSharing?.sharedSources ?? [])
		if (!routedComponents.has(defined(input.componentByEndpointId.get(id)))) sharedSources.add(id);
	for (const { relation } of passages)
		if (!routedComponents.has(defined(input.componentByEndpointId.get(relation.from))))
			sharedSources.add(relation.from);
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

/** Reserve faces before placement; channels are planned from the resulting transverse positions. */
export function allocateLayerPorts(input: ReservationInput): PortAllocation | undefined {
	const { graph, layers, bounds, frame } = input;
	const crossings = crossingCorridors({
		graph,
		ranks: layers.byId,
		bounds,
		vertical: frame.vertical,
		includeJunctions: true,
	});
	const passages = layerLinks(graph, layers, bounds, {
		vertical: frame.vertical,
		componentByEndpointId: input.componentByEndpointId,
	});
	if (crossings.length === 0 && passagesFitDirectly(input, passages)) {
		// A later ordinary reservation would move the rails and invalidate the direct passages.
		const ordinaryCrossings = crossingCorridors({
			graph,
			ranks: input.ranks,
			bounds,
			vertical: frame.vertical,
		});
		if (ordinaryCrossings.length === 0) {
			const blockedTargets = sharedTargetsBlockedByForeignGroups(input);
			if (blockedTargets.size === 0) return undefined;
			return reserveBlockedTargetPorts(input, passages, blockedTargets);
		}
	}
	return reserveOrdinaryPorts(input, crossings, passages);
}
