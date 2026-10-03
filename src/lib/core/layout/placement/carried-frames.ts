import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import {
	type MutableBounds,
	translateTransversely,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import type { GroupMeasurement, Size } from '../layout-types';
import { groupBlocks } from '../structure/group-blocks';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import {
	freeGroups,
	freeHolders,
	freeMembers,
	heldFreeGroups,
	placeFreeBeside,
} from './free-groups';
import { enclosure, type FrameReserve } from './group-enclosure';

/** What decides which frames a placed item carries: blocks, groups and ranked endpoints. */
export interface CarryContext {
	readonly graph: LogicGraph;
	readonly hierarchy: GroupHierarchy | undefined;
	readonly ranks: ReadonlyMap<string, number>;
}

const chainCache = new WeakMap<LogicGraph, ReadonlyMap<string, readonly string[]>>();

/**
 * Groups that are neither blocks nor row slots holding their members are drawn around what
 * they hold. Around a single placed item (a row item, a junction or a block), they are that
 * item's frames: a junction standing for a junction-only group, a related group or a block
 * inside related groups. Innermost first, by the item that carries them.
 */
export function carriedChains(context: CarryContext): ReadonlyMap<string, readonly string[]> {
	const cached = chainCache.get(context.graph);
	if (cached !== undefined) return cached;
	const chains = new Map<string, string[]>();
	chainCache.set(context.graph, chains);
	const { hierarchy, ranks } = context;
	if (hierarchy === undefined) return chains;
	const blocks = groupBlocks(context.graph).ids;
	const free = freeGroups(hierarchy, ranks);
	const holders = freeHolders(hierarchy, ranks);
	const items = new Map<string, ReadonlySet<string>>();
	const standing = new Set([...blocks, ...holders, ...free]);
	for (const group of hierarchy.deepestFirst) {
		const members = hierarchy.membersById.get(group.id) ?? [];
		if (members.length === 0 || standing.has(group.id)) continue;
		const placed = new Set(
			members
				.filter((member) => !free.has(member))
				.flatMap((member) => [...(items.get(member) ?? [member])]),
		);
		items.set(group.id, placed);
		const [item] = placed;
		if (placed.size !== 1 || item === undefined) continue;
		const chain = chains.get(item) ?? [];
		chain.push(group.id);
		chains.set(item, chain);
	}
	return chains;
}

/**
 * Transverse room a chain of carried frames takes around an item's box: their shells, free
 * members and minimum sizes, as enclosing them around the item will draw them.
 */
export function carriedRoom(
	placement: {
		readonly hierarchy: GroupHierarchy;
		readonly ranks: ReadonlyMap<string, number>;
		readonly groups: (id: string) => GroupMeasurement;
		readonly vertical: boolean;
	},
	item: { readonly id: string; readonly box: MutableBounds; readonly chain: readonly string[] },
): FrameReserve {
	const { hierarchy, groups, vertical } = placement;
	const held = heldFreeGroups(hierarchy, freeGroups(hierarchy, placement.ranks));
	const bounds = new Map<string, MutableBounds>([[item.id, { ...item.box }]]);
	for (const id of item.chain) {
		const members = hierarchy.membersById.get(id) ?? [];
		const loose = freeMembers(hierarchy, held, id).filter((member) => !bounds.has(member));
		const content = members.filter((member) => bounds.has(member));
		if (loose.length > 0) placeFreeBeside({ hierarchy, groups, bounds, vertical }, loose, content);
		bounds.set(
			id,
			enclosure(
				groups(id),
				members.filter((member) => bounds.has(member)),
				bounds,
			),
		);
	}
	const frame = defined(bounds.get(defined(item.chain.at(-1))));
	const start = transverseStart(item.box, vertical);
	return {
		before: start - transverseStart(frame, vertical),
		after:
			transverseStart(frame, vertical) +
			transverseSize(frame, vertical) -
			start -
			transverseSize(item.box, vertical),
	};
}

/** A placed item's slot, wider than the item by the frames it carries across the rows. */
export interface CarriedSlot {
	/** Transverse room the carried frames take before the item. */
	readonly before: number;
	/** The item's own size, restored once placed. */
	readonly size: Size;
}

export interface CarriedSizes {
	readonly sizes: ReadonlyMap<string, Size>;
	readonly slots: ReadonlyMap<string, CarriedSlot>;
}

/**
 * Sizes rows and rails place: an endpoint carrying frames takes their transverse extent, so no
 * neighbor stands where they are drawn. Blocks keep that room in their own frames.
 */
export function carriedSizes(
	context: CarryContext,
	input: {
		readonly groups: ReadonlyMap<string, GroupMeasurement>;
		readonly sizes: ReadonlyMap<string, Size>;
		readonly vertical: boolean;
	},
): CarriedSizes {
	const { sizes, vertical } = input;
	const chains = carriedChains(context);
	const { hierarchy } = context;
	if (chains.size === 0 || hierarchy === undefined) return { sizes, slots: new Map() };
	const placedSizes = new Map(sizes);
	const slots = new Map<string, CarriedSlot>();
	const groups = (id: string) => defined(input.groups.get(id));
	const placement = { hierarchy, ranks: context.ranks, groups, vertical };
	for (const [id, chain] of chains) {
		const size = sizes.get(id);
		if (size === undefined) continue;
		const room = carriedRoom(placement, { id, box: { x: 0, y: 0, ...size }, chain });
		const extent = room.before + transverseSize(size, vertical) + room.after;
		slots.set(id, { before: room.before, size });
		if (vertical) placedSizes.set(id, { width: extent, height: size.height });
		else placedSizes.set(id, { width: size.width, height: extent });
	}
	return { sizes: placedSizes, slots };
}

/** Return each carrying item from its slot to its own size, where its frames enclose it. */
export function seatCarriedItems(
	bounds: ReadonlyMap<string, MutableBounds>,
	slots: ReadonlyMap<string, CarriedSlot>,
	vertical: boolean,
): void {
	for (const [id, { before, size }] of slots) {
		const box = defined(bounds.get(id));
		translateTransversely(box, before, vertical);
		if (vertical) box.width = size.width;
		else box.height = size.height;
	}
}
