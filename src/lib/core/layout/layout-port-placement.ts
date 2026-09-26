import { defined } from '../document/logic-document';
import type { alignBypassedChains } from './placement/bypassed-chain-alignment';
import { placeElements, type PlacementInput } from './placement/place-elements';
import type { PortAllocation } from './routing/port-allocation';

interface PlacementReservation {
	readonly gaps: ReadonlyMap<number, number>;
	readonly channelGaps?: ReadonlyMap<number, readonly number[]>;
}

function alignBranchesWithPorts(workspace: PlacementInput, ports: PortAllocation): void {
	const offsets = new Map<string, number>();
	for (const [id, anchor] of workspace.structure.branchAnchors) {
		const source = ports.sourceOffsets.get(anchor.relationId) ?? 0;
		const target = ports.targetOffsets.get(anchor.relationId) ?? 0;
		offsets.set(id, target - source);
	}
	workspace.placement.branchOffsets = offsets;
}

/** Applying a proposal or restoring its predecessor updates the same placement inputs. */
export function placeWithPorts(
	workspace: PlacementInput,
	ports: PortAllocation,
	reservation?: PlacementReservation,
): void {
	alignBranchesWithPorts(workspace, ports);
	for (const [id, size] of ports.sizes) workspace.measurements.sizes.set(id, size);
	placeElements(workspace, reservation?.gaps ?? new Map(), reservation?.channelGaps);
}

export function withChainAlignment(
	ports: PortAllocation,
	alignment: ReturnType<typeof alignBypassedChains>,
): PortAllocation {
	if (alignment === undefined) return ports;
	return {
		...ports,
		sizes: new Map([...ports.sizes, ...alignment.sizes]),
		sourceOffsets: new Map([...ports.sourceOffsets, ...alignment.sourceOffsets]),
		targetOffsets: new Map([...ports.targetOffsets, ...alignment.targetOffsets]),
	};
}

export function portsChangePlacement(workspace: PlacementInput, ports: PortAllocation): boolean {
	const { structure, measurements, placement, frame } = workspace;
	for (const demand of ports.metricDemands) {
		const size = defined(measurements.sizes.get(demand.endpointId));
		if (frame.vertical && size.width < demand.minimumCrossSize) return true;
		if (!frame.vertical && size.height < demand.minimumCrossSize) return true;
	}
	for (const [id, anchor] of structure.branchAnchors) {
		const offset =
			(ports.targetOffsets.get(anchor.relationId) ?? 0) -
			(ports.sourceOffsets.get(anchor.relationId) ?? 0);
		if (offset !== (placement.branchOffsets?.get(id) ?? 0)) return true;
	}
	return false;
}
