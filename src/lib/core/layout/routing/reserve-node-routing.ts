import { defined } from '../../document/logic-document';
import { transverseCenter } from '../geometry/layout-frame';
import { BASE_RANK_GAP, RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { routeOwnedChannel } from './channel-routing';
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
		const channel = routeOwnedChannel(
			corridor.links.map(({ relation, source, target }) => {
				let sourceCenter = source;
				let targetCenter = target;
				if (centers !== undefined) {
					sourceCenter = defined(centers.get(relation.from));
					targetCenter = defined(centers.get(relation.to));
				}
				return {
					id: relation.id,
					sharedSource: sourcePorts?.get(relation.id),
					source: sourceCenter + defined(input.ports.sourceOffsets.get(relation.id)),
					target: targetCenter + defined(input.ports.targetOffsets.get(relation.id)),
					first: undefined,
					last: undefined,
					middle: undefined,
				};
			}),
			corridor.cornerOnly === true,
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
