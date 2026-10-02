import { defined } from '../../document/logic-document';
import { orderEndpoints } from '../../ordering/endpoint-order';
import {
	boundsOnAxes,
	mainSize,
	mainStart,
	type MutableBounds,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { ITEM_GAP } from '../layout-settings';
import type { GroupMeasurement } from '../layout-types';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import { enclosure } from './group-enclosure';

/**
 * Groups holding no ranked endpoint at any depth: no row places them. Inside a block they stand
 * beside its content, so that its frame holds them before its container places it.
 */
export function freeGroups(
	hierarchy: GroupHierarchy,
	ranks: ReadonlyMap<string, number>,
): ReadonlySet<string> {
	const free = new Set<string>();
	for (const group of hierarchy.deepestFirst) {
		if (ranks.has(group.id)) continue;
		const members = hierarchy.membersById.get(group.id) ?? [];
		if (members.every((id) => free.has(id))) free.add(group.id);
	}
	return free;
}

/**
 * Related groups holding nothing but free groups: no node or related group makes them blocks,
 * so they keep their own row slot, which holds their members side by side.
 */
export function freeHolders(
	hierarchy: GroupHierarchy | undefined,
	ranks: ReadonlyMap<string, number>,
): ReadonlySet<string> {
	const holders = new Set<string>();
	if (hierarchy === undefined) return holders;
	const free = freeGroups(hierarchy, ranks);
	for (const [id, members] of hierarchy.membersById)
		if (ranks.has(id) && members.every((member) => free.has(member))) holders.add(id);
	return holders;
}

/**
 * Free groups inside a group that is not free: their holder places them beside its content,
 * nested free groups included, so no packing cursor ever does.
 */
export function heldFreeGroups(
	hierarchy: GroupHierarchy,
	free: ReadonlySet<string>,
): ReadonlySet<string> {
	const held = new Set<string>();
	for (const group of hierarchy.deepestFirst.toReversed()) {
		const parent = group.groupId;
		if (parent === undefined || !free.has(group.id)) continue;
		if (!free.has(parent) || held.has(parent)) held.add(group.id);
	}
	return held;
}

/** The free groups among a container's members, in documentary order. */
export function freeMembers(
	hierarchy: GroupHierarchy,
	free: ReadonlySet<string>,
	container: string,
): readonly string[] {
	const groups = (hierarchy.membersById.get(container) ?? [])
		.filter((id) => free.has(id))
		.map((id) => defined(hierarchy.byId.get(id)));
	return orderEndpoints(groups);
}

interface FreeMeasurement {
	readonly hierarchy: GroupHierarchy;
	readonly groups: (id: string) => GroupMeasurement;
	readonly vertical: boolean;
}

export interface FreePlacement extends FreeMeasurement {
	readonly bounds: Map<string, MutableBounds>;
}

/**
 * Place a free group with its frame starting at `cross` and `main`. Its members, free groups
 * too, stand side by side inside, after the padding and the header on the physical top.
 */
export function placeFreeGroup(
	placement: FreePlacement,
	id: string,
	at: { readonly cross: number; readonly main: number },
): MutableBounds {
	const { hierarchy, bounds, vertical } = placement;
	const measurement = placement.groups(id);
	const members = (hierarchy.membersById.get(id) ?? []).map((member) =>
		defined(hierarchy.byId.get(member)),
	);
	let box: MutableBounds;
	if (members.length === 0) {
		const size = { width: measurement.minimumWidth, height: measurement.minimumHeight };
		box = boundsOnAxes(at.cross, at.main, size, vertical);
	} else {
		const top = measurement.headerHeight + measurement.padding;
		let cross = at.cross + measurement.padding;
		let main = at.main + top;
		if (!vertical) {
			cross = at.cross + top;
			main = at.main + measurement.padding;
		}
		const ordered = orderEndpoints(members);
		for (const member of ordered) {
			const placed = placeFreeGroup(placement, member, { cross, main });
			cross = transverseStart(placed, vertical) + transverseSize(placed, vertical) + ITEM_GAP;
		}
		box = enclosure(measurement, ordered, bounds);
	}
	bounds.set(id, box);
	return box;
}

/**
 * Free groups stand side by side after their holder's content, from its physical main start:
 * the holder's frame then holds them.
 */
export function placeFreeBeside(
	placement: FreePlacement,
	free: readonly string[],
	content: readonly string[],
): void {
	const { bounds, vertical } = placement;
	let cross = Number.NEGATIVE_INFINITY;
	let main = Number.POSITIVE_INFINITY;
	for (const id of content) {
		const box = defined(bounds.get(id));
		cross = Math.max(cross, transverseStart(box, vertical) + transverseSize(box, vertical));
		main = Math.min(main, mainStart(box, vertical));
	}
	for (const id of free) {
		const box = placeFreeGroup(placement, id, { cross: cross + ITEM_GAP, main });
		cross = transverseStart(box, vertical) + transverseSize(box, vertical);
	}
}

/**
 * Main length of the free groups standing beside each holder's content, from the content's
 * physical main start: what they add to the frame along the flow when they outgrow it.
 */
export function freeContentLengths(
	placement: FreeMeasurement,
	ranks: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
	const lengths = new Map<string, number>();
	const free = freeGroups(placement.hierarchy, ranks);
	if (free.size === 0) return lengths;
	for (const holder of placement.hierarchy.membersById.keys()) {
		if (free.has(holder)) continue;
		for (const id of freeMembers(placement.hierarchy, free, holder)) {
			const box = placeFreeGroup({ ...placement, bounds: new Map() }, id, { cross: 0, main: 0 });
			lengths.set(holder, Math.max(lengths.get(holder) ?? 0, mainSize(box, placement.vertical)));
		}
	}
	return lengths;
}
