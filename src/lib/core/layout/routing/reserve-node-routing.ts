import { defined } from '../../document/logic-document';
import { transverseCenter } from '../geometry/layout-frame';
import { BASE_RANK_GAP, RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { routeChannel } from './channel-routing';
import type { ChannelRouting } from './channel-types';
import { type PortAllocation, sharedSourcePorts } from './port-allocation';
import type { RoutingCorridor } from './routing-corridors';

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
	const corridors = input.corridors.map((corridor) => {
		const sourcePorts = sharedSourcePorts(
			corridor.links.map(({ relation }) => relation),
			input.ports.sourceOffsets,
		);
		const channel = routeChannel(
			corridor.links.map(({ relation }) => ({
				id: relation.id,
				sharedSource: sourcePorts.get(relation.id),
				source:
					transverseCenter(defined(input.bounds.get(relation.from)), input.vertical) +
					defined(input.ports.sourceOffsets.get(relation.id)),
				target:
					transverseCenter(defined(input.bounds.get(relation.to)), input.vertical) +
					defined(input.ports.targetOffsets.get(relation.id)),
			})),
		);
		const count = Math.max(railCounts.get(corridor.rank) ?? 0, channel.railCount);
		railCounts.set(corridor.rank, count);
		gaps.set(corridor.rank, BASE_RANK_GAP + Math.max(0, count - 1) * RAIL_SPACING);
		return { ...channel, corridor };
	});
	return { corridors, gaps, railCounts, ports: input.ports, ranks: input.ranks };
}
