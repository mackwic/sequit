import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import { BASE_RANK_GAP, RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { routeOwnedChannel } from './channel-routing';
import type { ChannelRouting } from './channel-types';
import { type PortAllocation, sharedSourcePorts } from './port-allocation';
import { crossingCorridors, type RoutingCorridor } from './routing-corridors';

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

export function planNodeRouting(input: {
	readonly corridors: readonly RoutingCorridor[];
	readonly ports: PortAllocation;
	readonly ranks: ReadonlyMap<string, number>;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
}): NodeRouting {
	const gaps = new Map<number, number>();
	const railCounts = new Map<number, number>();
	const centers = new Map(
		[...input.bounds].map(([id, box]) => [id, transverseCenter(box, input.vertical)]),
	);
	const corridors = input.corridors.map((corridor) => {
		let sourcePorts: ReadonlyMap<string, string> | undefined;
		if (input.ports.hasSharedSourcePorts)
			sourcePorts = sharedSourcePorts(
				corridor.links.map(({ relation }) => relation),
				input.ports.sourceOffsets,
			);
		const channel = routeOwnedChannel(
			corridor.links.map(({ relation }) => ({
				id: relation.id,
				sharedSource: sourcePorts?.get(relation.id),
				source:
					defined(centers.get(relation.from)) + defined(input.ports.sourceOffsets.get(relation.id)),
				target:
					defined(centers.get(relation.to)) + defined(input.ports.targetOffsets.get(relation.id)),
				first: undefined,
				last: undefined,
				middle: undefined,
			})),
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

/** Rebuild corridors after group-aware placement changes transverse positions. */
export function stabilizeNodeRouting(
	geometry: {
		readonly graph: LogicGraph;
		readonly ranks: ReadonlyMap<string, number>;
		readonly bounds: ReadonlyMap<string, Bounds>;
		readonly vertical: boolean;
	},
	ports: PortAllocation,
	initial: NodeRouting,
	place: (gaps: ReadonlyMap<number, number>) => void,
): NodeRouting {
	const reservation = new Map(initial.gaps);
	for (;;) {
		const corridors = crossingCorridors(geometry);
		const plan = planNodeRouting({ ...geometry, corridors, ports });
		let expanded = false;
		for (const [rank, gap] of plan.gaps) {
			if (gap <= (reservation.get(rank) ?? 0)) continue;
			reservation.set(rank, gap);
			expanded = true;
		}
		if (!expanded) return plan;
		place(reservation);
	}
}
