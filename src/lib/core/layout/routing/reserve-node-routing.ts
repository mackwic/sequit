import { defined } from '../../document/logic-document';
import { transverseCenter } from '../geometry/layout-frame';
import { BASE_RANK_GAP, RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { routeOwnedChannel } from './channel-routing';
import type { ChannelWire } from './channel-types';
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

export function planNodeRouting(input: {
	readonly corridors: readonly RoutingCorridor[];
	readonly ports: PortAllocation;
	readonly ranks: ReadonlyMap<string, number>;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	/** Input corridor coordinates remain valid when port allocation did not move the placement. */
	readonly reuseCorridorCenters?: boolean;
}): NodeRouting {
	const gaps = new Map<number, number>();
	const railCounts = new Map<number, number>();
	let centers: Map<string, number> | undefined;
	if (input.reuseCorridorCenters !== true)
		centers = new Map(
			[...input.bounds].map(([id, box]) => [id, transverseCenter(box, input.vertical)]),
		);
	const corridors = input.corridors.map((corridor) => {
		const sourcePorts = corridorSourcePorts(corridor, input.ports);
		let wires: ChannelWire[];
		if (centers === undefined) {
			wires = corridor.links.map(({ relation, source, target }) => ({
				id: relation.id,
				sharedSource: sourcePorts?.get(relation.id),
				source: source + defined(input.ports.sourceOffsets.get(relation.id)),
				target: target + defined(input.ports.targetOffsets.get(relation.id)),
				first: undefined,
				last: undefined,
				middle: undefined,
			}));
		} else {
			wires = corridor.links.map(({ relation }) => ({
				id: relation.id,
				sharedSource: sourcePorts?.get(relation.id),
				source:
					defined(centers.get(relation.from)) + defined(input.ports.sourceOffsets.get(relation.id)),
				target:
					defined(centers.get(relation.to)) + defined(input.ports.targetOffsets.get(relation.id)),
				first: undefined,
				last: undefined,
				middle: undefined,
			}));
		}
		const channel = routeOwnedChannel(wires, corridor.cornerOnly === true);
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
