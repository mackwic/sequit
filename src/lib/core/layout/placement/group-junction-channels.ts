import { defined, EndpointKind } from '../../document/logic-document';
import { type LayoutFrame, mainSize } from '../geometry/layout-frame';
import { JUNCTION_CLEARANCE } from '../layout-settings';
import type { Bounds } from '../layout-types';
import type { LayoutStructure } from '../structure/prepare-layout';
import { type JunctionRail, railSpan } from './junction-rails';

function extent(box: Bounds, frame: LayoutFrame): { start: number; end: number } {
	let start = box.x;
	if (frame.vertical) start = box.y;
	const end = start + mainSize(box, frame.vertical);
	if (frame.forward) return { start, end };
	return { start: -end, end: -start };
}

/** Reserve against the measured container boundary, including minimum sizes and nested shells. */
export function groupJunctionInsets(
	structure: LayoutStructure,
	bounds: ReadonlyMap<string, Bounds>,
	frame: LayoutFrame,
): ReadonlyMap<number, readonly number[]> {
	const result = new Map<number, number[]>();
	if (structure.hierarchy === undefined || structure.junctionIds.size === 0) return result;
	for (const { source, target } of structure.graph.relations) {
		let group = source;
		let junction = target;
		let groupAfter = true;
		if (source.kind === EndpointKind.Junction) {
			group = target;
			junction = source;
			groupAfter = false;
		}
		if (group.kind !== EndpointKind.Group || junction.kind !== EndpointKind.Junction) continue;
		if ((structure.hierarchy.membersById.get(group.entity.id)?.length ?? 0) === 0) continue;
		const groupExtent = extent(defined(bounds.get(group.entity.id)), frame);
		const junctionExtent = extent(defined(bounds.get(junction.entity.id)), frame);
		const placement = defined(structure.junctions.get(junction.entity.id));
		let slot = placement.depth;
		let clearance = junctionExtent.start - groupExtent.end;
		if (groupAfter) {
			slot += 1;
			clearance = groupExtent.start - junctionExtent.end;
		}
		const missing = Math.max(0, JUNCTION_CLEARANCE - clearance);
		if (missing === 0) continue;
		const insets = result.get(placement.interval) ?? [];
		insets[slot] = Math.max(insets[slot] ?? 0, missing);
		result.set(placement.interval, insets);
	}
	return result;
}

/** Container insets add to a slot: container clearances measured after placement are missing. */
export interface JunctionChannelReservation {
	readonly insets?: readonly number[] | undefined;
	/** Structural minimum gap of each slot, whatever the channel already holds. */
	readonly minimums?: readonly number[] | undefined;
}

/** Preserve already allocated slack before adding a container's missing channel clearance. */
export function insetJunctionChannels(
	rails: readonly JunctionRail[],
	minimumSpan: number,
	channels: readonly number[] | undefined,
	reservation: JunctionChannelReservation,
): readonly number[] {
	const span = railSpan(rails, channels);
	const extra = Math.max(0, minimumSpan - span) / 2;
	return Array.from({ length: rails.length + 1 }, (_, index) => {
		let gap = channels?.[index] ?? JUNCTION_CLEARANCE;
		if (index === 0 || index === rails.length) gap += extra;
		gap += reservation.insets?.[index] ?? 0;
		return Math.max(gap, reservation.minimums?.[index] ?? 0);
	});
}
