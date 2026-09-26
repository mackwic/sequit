import { defined, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import type { Bounds, Size } from '../layout-types';
import { allocatePorts, type PortAllocation } from './port-allocation';
import {
	cornerPortSharing,
	type CorridorLink,
	crossingCorridors,
	type RoutingCorridor,
} from './routing-corridors';

interface PortDemand {
	readonly rank: number;
	readonly relation: LogicRelation;
	readonly cornerOnly: boolean;
}

function recordPortDemand(
	demanded: Map<string, PortDemand>,
	corridor: RoutingCorridor,
	relation: LogicRelation,
): boolean {
	const previous = demanded.get(relation.id);
	if (previous !== undefined) {
		if (!previous.cornerOnly || corridor.cornerOnly === true) return false;
		demanded.set(relation.id, { ...previous, cornerOnly: false });
		return true;
	}
	demanded.set(relation.id, {
		rank: corridor.rank,
		relation,
		cornerOnly: corridor.cornerOnly === true,
	});
	return true;
}

function includeCorridorLinks(
	demanded: Map<string, PortDemand>,
	corridors: readonly RoutingCorridor[],
): boolean {
	let added = false;
	for (const corridor of corridors)
		for (const { relation } of corridor.links)
			if (recordPortDemand(demanded, corridor, relation)) added = true;
	return added;
}

/** Preserve a face request once made, even if a later placement moves its link out of a corridor. */
function faceDemands(
	demanded: ReadonlyMap<string, PortDemand>,
	bounds: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): RoutingCorridor[] {
	const byRank = new Map<number, { crossing: CorridorLink[]; corners: CorridorLink[] }>();
	for (const { rank, relation, cornerOnly } of demanded.values()) {
		let faces = byRank.get(rank);
		if (faces === undefined) {
			faces = { crossing: [], corners: [] };
			byRank.set(rank, faces);
		}
		let links = faces.crossing;
		if (cornerOnly) links = faces.corners;
		links.push({
			relation,
			source: transverseCenter(defined(bounds.get(relation.from)), vertical),
			target: transverseCenter(defined(bounds.get(relation.to)), vertical),
		});
	}
	const result: RoutingCorridor[] = [];
	for (const [rank, { crossing, corners }] of byRank) {
		if (crossing.length > 0) result.push({ rank, links: crossing });
		if (corners.length > 0) result.push({ rank, links: corners, cornerOnly: true });
	}
	return result;
}

/** Grow only the set of face demands; never replan routes with ports from an older corridor set. */
export function settleGroupCorridorPorts(input: {
	readonly graph: LogicGraph;
	readonly ranks: ReadonlyMap<string, number>;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly initial: readonly RoutingCorridor[];
	readonly initialPorts: PortAllocation;
	readonly place: (ports: PortAllocation) => void;
}): { readonly corridors: readonly RoutingCorridor[]; readonly ports: PortAllocation } {
	const { graph, ranks, bounds, vertical, sizes, initial, place } = input;
	const demanded = new Map<string, PortDemand>();
	includeCorridorLinks(demanded, initial);
	let ports = input.initialPorts;
	let grew = false;
	for (;;) {
		const current = crossingCorridors({ graph, ranks, bounds, vertical });
		if (!includeCorridorLinks(demanded, current)) {
			if (!grew) return { ports, corridors: initial };
			return { ports, corridors: current };
		}
		grew = true;
		const requests = faceDemands(demanded, bounds, vertical);
		ports = allocatePorts({
			corridors: requests,
			...cornerPortSharing(requests),
			sizes,
			vertical,
			graph,
			bounds,
		});
		place(ports);
	}
}
