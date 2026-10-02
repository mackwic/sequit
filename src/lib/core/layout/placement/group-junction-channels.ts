import { defined, EndpointKind } from '../../document/logic-document';
import {
	type LayoutFrame,
	mainSize,
	mainStart,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { GROUP_FRAME_CLEARANCE, JUNCTION_CLEARANCE } from '../layout-settings';
import type { Bounds } from '../layout-types';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import type { LayoutStructure } from '../structure/prepare-layout';
import { groupSpans } from './group-spans';
import { type JunctionRail, railSpan } from './junction-rails';

function extent(box: Bounds, frame: LayoutFrame): { start: number; end: number } {
	let start = box.x;
	if (frame.vertical) start = box.y;
	const end = start + mainSize(box, frame.vertical);
	if (frame.forward) return { start, end };
	return { start: -end, end: -start };
}

/** Widen one slot of an interval's junction channel by a measured missing clearance. */
function reserve(
	result: Map<number, number[]>,
	slot: { readonly interval: number; readonly index: number },
	missing: number,
): void {
	if (missing <= 0) return;
	const insets = result.get(slot.interval) ?? [];
	insets[slot.index] = Math.max(insets[slot.index] ?? 0, missing);
	result.set(slot.interval, insets);
}

/** A group, its ancestors and everything it holds: none is foreign to its frame. */
function kin(hierarchy: GroupHierarchy, groupId: string): ReadonlySet<string> {
	const ids = new Set<string>();
	let ancestor = hierarchy.byId.get(groupId)?.groupId;
	while (ancestor !== undefined) {
		ids.add(ancestor);
		ancestor = hierarchy.byId.get(ancestor)?.groupId;
	}
	const pending = [groupId];
	while (pending.length > 0) {
		const id = defined(pending.pop());
		ids.add(id);
		pending.push(...(hierarchy.membersById.get(id) ?? []));
	}
	return ids;
}

/**
 * Clearance a frame lacks, physically down or right of its junctions, before the foreign
 * elements it overlaps transversally.
 */
function farClearance(
	structure: LayoutStructure,
	bounds: ReadonlyMap<string, Bounds>,
	input: { readonly groupId: string; readonly vertical: boolean },
): number {
	const { groupId, vertical } = input;
	const related = kin(defined(structure.hierarchy), groupId);
	const box = defined(bounds.get(groupId));
	const end = mainStart(box, vertical) + mainSize(box, vertical);
	const crossStart = transverseStart(box, vertical);
	const crossEnd = crossStart + transverseSize(box, vertical);
	let railEnd = Number.NEGATIVE_INFINITY;
	for (const id of related) {
		const junction = bounds.get(id);
		if (!structure.junctionIds.has(id) || junction === undefined) continue;
		railEnd = Math.max(railEnd, mainStart(junction, vertical) + mainSize(junction, vertical));
	}
	let missing = 0;
	for (const [id, other] of bounds) {
		const start = mainStart(other, vertical);
		const otherStart = transverseStart(other, vertical);
		const otherEnd = otherStart + transverseSize(other, vertical);
		const apart = otherStart >= crossEnd || otherEnd <= crossStart;
		if (related.has(id) || start < railEnd || apart) continue;
		missing = Math.max(missing, end + GROUP_FRAME_CLEARANCE - start);
	}
	return missing;
}

/**
 * A frame ending physically down or right on a junction rail grows past it by its shell, by the
 * free groups and minimum main size of a frame holding only that rail, and by its nested frames.
 * The rail's slot on that side widens by the clearance the frame lacks, as placed, before what
 * it overlaps transversally: that growth is reserved only where it meets something.
 */
export function railFrameInsets(
	structure: LayoutStructure,
	bounds: ReadonlyMap<string, Bounds>,
	frame: LayoutFrame,
): ReadonlyMap<number, readonly number[]> {
	const result = new Map<number, number[]>();
	if (structure.hierarchy === undefined || structure.junctionIds.size === 0) return result;
	const spans = groupSpans(structure);
	for (const [groupId, rails] of spans.rails) {
		const ranks = spans.ranks.get(groupId);
		// Rank r lies before interval r's rails, rank r + 1 after them.
		let rail = rails.first;
		let index = rail.depth;
		let beyond = (ranks?.first ?? Number.POSITIVE_INFINITY) <= rail.interval;
		if (frame.forward) {
			rail = rails.last;
			index = rail.depth + 1;
			beyond = (ranks?.last ?? Number.NEGATIVE_INFINITY) > rail.interval;
		}
		if (beyond) continue;
		const missing = farClearance(structure, bounds, { groupId, vertical: frame.vertical });
		reserve(result, { interval: rail.interval, index }, missing);
	}
	return result;
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
		let index = placement.depth;
		let clearance = junctionExtent.start - groupExtent.end;
		if (groupAfter) {
			index += 1;
			clearance = groupExtent.start - junctionExtent.end;
		}
		reserve(result, { interval: placement.interval, index }, JUNCTION_CLEARANCE - clearance);
	}
	return result;
}

/** Container insets add to a slot: container clearances measured after placement are missing. */
export interface JunctionChannelReservation {
	readonly insets?: readonly number[] | undefined;
	/** Structural minimum gap of each slot, whatever the channel already holds. */
	readonly minimums?: readonly number[] | undefined;
	/** Clearance frames lacked past their rail when placed with this very reservation. */
	readonly overflows?: readonly number[] | undefined;
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
		gap = Math.max(gap, reservation.minimums?.[index] ?? 0);
		return gap + (reservation.overflows?.[index] ?? 0);
	});
}
