import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import { BASE_RANK_GAP, RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { routeOwnedChannel } from './channel-routing';
import type { ChannelRoutingCache } from './channel-routing-cache';
import type { ChannelRouting, ChannelWire } from './channel-types';
import { type PortAllocation, sharedSourcePorts } from './port-allocation';
import { RelationPortOffsets } from './relation-port-offsets';
import type { CorridorLink, RoutingCorridor } from './routing-corridors';

interface PlannedCorridor extends ChannelRouting {
	readonly corridor: RoutingCorridor;
}
export interface NodeRouting {
	readonly ports: PortAllocation;
	readonly ranks: ReadonlyMap<string, number>;
	readonly corridors: readonly PlannedCorridor[];
	readonly gaps: ReadonlyMap<number, number>;
	readonly railCounts: ReadonlyMap<number, number>;
}

/** Only endpoints sharing an actual corner-corridor face need expensive family grouping. */
function corridorSourcePorts(
	corridor: RoutingCorridor,
	ports: PortAllocation,
): ReadonlyMap<string, string> | undefined {
	if (!ports.hasSharedSourcePorts) return undefined;
	if (corridor.cornerOnly === true) {
		const sources = new Set<string>();
		let repeated = false;
		for (const { relation } of corridor.links) {
			if (sources.has(relation.from)) {
				repeated = true;
				break;
			}
			sources.add(relation.from);
		}
		if (!repeated) return undefined;
	}
	return sharedSourcePorts(
		corridor.links.map(({ relation }) => relation),
		ports.sourceOffsets,
	);
}

/** A link's port offset, by relation index when the corridor indexes the allocation's graph. */
function offsetReader(
	offsets: ReadonlyMap<string, number>,
	corridor: RoutingCorridor,
): (link: CorridorLink) => number {
	if (offsets instanceof RelationPortOffsets && offsets.indexesCorridor(corridor))
		return (link) => defined(offsets.at(defined(link.relationIndex)));
	return (link) => defined(offsets.get(link.relation.id));
}

export function planNodeRouting(input: {
	readonly graph: LogicGraph;
	readonly corridors: readonly RoutingCorridor[];
	readonly ports: PortAllocation;
	readonly ranks: ReadonlyMap<string, number>;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	/** Input corridor coordinates remain valid when port allocation did not move the placement. */
	readonly reuseCorridorCenters?: boolean;
	/** Borrowed from the projection: exact channel inputs replay a remembered routing. */
	readonly channels?: ChannelRoutingCache | undefined;
}): NodeRouting {
	const channels = input.channels;
	let route: (wires: ChannelWire[], nonInverted: boolean, ownerId: string) => ChannelRouting =
		routeOwnedChannel;
	if (channels !== undefined)
		route = (wires, nonInverted, ownerId) => channels.route(wires, nonInverted, ownerId);
	const gaps = new Map<number, number>();
	const railCounts = new Map<number, number>();
	let centers: Map<string, number> | undefined;
	if (input.reuseCorridorCenters !== true)
		centers = new Map(
			[...input.bounds].map(([id, box]) => [id, transverseCenter(box, input.vertical)]),
		);
	const corridors = input.corridors.map((corridor) => {
		const sourcePorts = corridorSourcePorts(corridor, input.ports);
		const sourceOffset = offsetReader(input.ports.sourceOffsets, corridor);
		const targetOffset = offsetReader(input.ports.targetOffsets, corridor);
		let wires: ChannelWire[];
		if (centers === undefined) {
			wires = corridor.links.map((link) => ({
				id: link.relation.id,
				sourceEndpoint: input.graph.endpointsById.get(link.relation.from),
				targetEndpoint: input.graph.endpointsById.get(link.relation.to),
				sharedSource: sourcePorts?.get(link.relation.id),
				source: link.source + sourceOffset(link),
				target: link.target + targetOffset(link),
				first: undefined,
				last: undefined,
				middle: undefined,
			}));
		} else {
			wires = corridor.links.map((link) => ({
				id: link.relation.id,
				sourceEndpoint: input.graph.endpointsById.get(link.relation.from),
				targetEndpoint: input.graph.endpointsById.get(link.relation.to),
				sharedSource: sourcePorts?.get(link.relation.id),
				source: defined(centers.get(link.relation.from)) + sourceOffset(link),
				target: defined(centers.get(link.relation.to)) + targetOffset(link),
				first: undefined,
				last: undefined,
				middle: undefined,
			}));
		}
		const channel = route(
			wires,
			corridor.cornerOnly === true,
			`@root/channel/corridor-${corridor.rank}`,
		);
		const count = Math.max(railCounts.get(corridor.rank) ?? 0, channel.railCount);
		railCounts.set(corridor.rank, count);
		gaps.set(corridor.rank, BASE_RANK_GAP + Math.max(0, count - 1) * RAIL_SPACING);
		return { ...channel, corridor };
	});
	return {
		corridors,
		gaps,
		railCounts,
		ports: input.ports,
		ranks: input.ranks,
	};
}
