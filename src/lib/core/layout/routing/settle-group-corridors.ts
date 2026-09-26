import { defined, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import type { Bounds, Size } from '../layout-types';
import { allocatePorts, type PortAllocation } from './port-allocation';
import { crossingCorridors, type RoutingCorridor } from './routing-corridors';

interface PortDemand {
	readonly rank: number;
	readonly relation: LogicRelation;
}

function includeCorridorLinks(
	demanded: Map<string, PortDemand>,
	corridors: readonly RoutingCorridor[],
): boolean {
	let added = false;
	for (const corridor of corridors)
		for (const { relation } of corridor.links) {
			if (demanded.has(relation.id)) continue;
			demanded.set(relation.id, { rank: corridor.rank, relation });
			added = true;
		}
	return added;
}

/** Preserve a face request once made, even if a later placement moves its link out of a corridor. */
function faceDemands(
	demanded: ReadonlyMap<string, PortDemand>,
	bounds: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): RoutingCorridor[] {
	const byRank = new Map<number, RoutingCorridor['links'][number][]>();
	for (const { rank, relation } of demanded.values()) {
		const links = byRank.get(rank) ?? [];
		links.push({
			relation,
			source: transverseCenter(defined(bounds.get(relation.from)), vertical),
			target: transverseCenter(defined(bounds.get(relation.to)), vertical),
		});
		byRank.set(rank, links);
	}
	return [...byRank].map(([rank, links]) => ({ rank, links }));
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
		ports = allocatePorts({
			corridors: faceDemands(demanded, bounds, vertical),
			sizes,
			vertical,
			graph,
			bounds,
		});
		place(ports);
	}
}
