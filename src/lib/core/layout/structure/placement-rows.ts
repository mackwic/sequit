import { defined } from '../../document/logic-document';
import { deriveEndpointRows, type EndpointRows } from '../../ordering/endpoint-order';
import {
	commonContainer,
	expandSlots,
	type GroupBlocks,
	type RowContainers,
	rowContainers,
} from './group-blocks';
import { throughJunctions } from './relation-adjacency';

/** Placement rows currently follow logical rank; junction rows occupy the following interval. */
export type PlacementRows = EndpointRows;

export interface RankedComponent {
	readonly ids: readonly string[];
	/** Documentary root-group ordinals, with the virtual root last. */
	readonly context: readonly number[];
	readonly effectiveOrder: number;
	readonly rows: PlacementRows;
}

/** Relations as documented, a relation to a group reaching its frame, and the junctions. */
export interface RowRelations {
	readonly outgoing: ReadonlyMap<string, readonly string[]>;
	readonly incoming: ReadonlyMap<string, readonly string[]>;
	readonly junctionIds: ReadonlySet<string>;
}

interface RowContext {
	readonly blocks: GroupBlocks;
	readonly keys: ReadonlyMap<string, number>;
	readonly relations: RowRelations;
}

/** Related items of the neighbor rows: placed ones above, blocks reaching the row below. */
interface Neighbors {
	readonly above: string[];
	readonly below: string[];
}

/**
 * Items of the neighbor rows each item of this row is related to, in the innermost container
 * holding both endpoints: a relation only constrains the order there.
 */
function rowNeighbors(
	row: readonly string[],
	rows: { readonly above: ReadonlySet<string>; readonly below: ReadonlySet<string> },
	context: RowContext,
): ReadonlyMap<string | undefined, ReadonlyMap<string, Neighbors>> {
	const { blocks, relations } = context;
	const found = new Map<string | undefined, Map<string, Neighbors>>();
	const record = (id: string, neighbor: string): void => {
		const above = rows.above.has(neighbor);
		if (!above && !rows.below.has(neighbor)) return;
		const common = commonContainer(blocks, id, neighbor);
		if (common === undefined) return;
		const byItem = found.get(common.container) ?? new Map<string, Neighbors>();
		found.set(common.container, byItem);
		const neighbors = byItem.get(common.left) ?? { above: [], below: [] };
		byItem.set(common.left, neighbors);
		if (above) neighbors.above.push(common.right);
		else neighbors.below.push(common.right);
	};
	for (const id of row)
		for (const edges of [relations.outgoing, relations.incoming])
			for (const neighbor of throughJunctions(id, edges, relations.junctionIds))
				record(id, neighbor);
	return found;
}

/** Walls in order, and the side of the walls each other item of the previous row stands on. */
interface WallSides {
	readonly walls: readonly string[];
	readonly indexOf: ReadonlyMap<string, number>;
	readonly sides: ReadonlyMap<string, number>;
}

interface SideRange {
	readonly low: number;
	readonly high: number;
}

/** Sides an item may take for each relation: next to a wall it relates to, or its item's side. */
function sideRanges(walls: WallSides, neighbors: Neighbors | undefined): readonly SideRange[] {
	const ranges: SideRange[] = [];
	for (const id of neighbors?.above ?? []) {
		const wall = walls.indexOf.get(id);
		const side = walls.sides.get(id);
		if (wall !== undefined) ranges.push({ low: wall, high: wall + 1 });
		else if (side !== undefined) ranges.push({ low: side, high: side });
	}
	// Below, only walls are already placed: a block continuing into the next row.
	for (const id of neighbors?.below ?? []) {
		const wall = walls.indexOf.get(id);
		if (wall !== undefined) ranges.push({ low: wall, high: wall + 1 });
	}
	return ranges;
}

function clamp(value: number, { low, high }: SideRange): number {
	return Math.min(Math.max(value, low), high);
}

/**
 * The side of the walls an item takes: its documentary side, moved into every range its
 * relations allow when they agree, else toward the median of their closest sides.
 */
function sideOf(
	item: string,
	walls: WallSides,
	keys: ReadonlyMap<string, number>,
	neighbors: Neighbors | undefined,
): number {
	const key = defined(keys.get(item));
	let side = walls.walls.findIndex((wall) => defined(keys.get(wall)) > key);
	if (side < 0) side = walls.walls.length;
	const ranges = sideRanges(walls, neighbors);
	if (ranges.length === 0) return side;
	const shared = {
		low: Math.max(...ranges.map(({ low }) => low)),
		high: Math.min(...ranges.map(({ high }) => high)),
	};
	if (shared.low <= shared.high) return clamp(side, shared);
	const closest = ranges.map((range) => clamp(side, range)).sort((left, right) => left - right);
	return defined(closest[Math.floor((closest.length - 1) / 2)]);
}

/**
 * A block continuing from the previous row is a wall: its frame joins both rows, so an item
 * related to the previous row stays on the side of its related items there. Other items keep
 * their documentary order between the walls.
 */
function arrangeAroundWalls(
	items: string[],
	previous: readonly string[],
	related: ReadonlyMap<string, Neighbors> | undefined,
	keys: ReadonlyMap<string, number>,
): void {
	const present = new Set(items);
	const walls = previous.filter((id) => present.has(id));
	if (walls.length === 0) return;
	const indexOf = new Map(walls.map((wall, index) => [wall, index]));
	const sides = new Map<string, number>();
	let crossed = 0;
	for (const id of previous) {
		if (indexOf.has(id)) crossed += 1;
		else sides.set(id, crossed);
	}
	const wallSides = { walls, indexOf, sides };
	const bySide = walls.map((): string[] => []);
	const last: string[] = [];
	for (const item of items) {
		if (indexOf.has(item)) continue;
		const side = sideOf(item, wallSides, keys, related?.get(item));
		(bySide[side] ?? last).push(item);
	}
	items.length = 0;
	for (const [index, wall] of walls.entries()) items.push(...defined(bySide[index]), wall);
	items.push(...last);
}

/** A row once ordered: its endpoints and the slots of its containers. */
interface PreviousRow {
	readonly ids: ReadonlySet<string>;
	readonly containers: RowContainers;
}

interface RowInput {
	readonly row: readonly string[];
	readonly below: ReadonlySet<string>;
	readonly context: RowContext;
}

/** Order each container of a row around the walls continuing from the row above. */
function arrangeRow(containers: RowContainers, previous: PreviousRow, input: RowInput): void {
	const walled = [...containers.slots].filter(([container, items]) =>
		(previous.containers.slots.get(container) ?? []).some(
			(id) => input.context.blocks.ids.has(id) && items.includes(id),
		),
	);
	// Without a block continuing from the row above, documentary order stands.
	if (walled.length === 0) return;
	const votes = rowNeighbors(input.row, { above: previous.ids, below: input.below }, input.context);
	for (const [container, items] of walled) {
		const above = defined(previous.containers.slots.get(container));
		arrangeAroundWalls(items, above, votes.get(container), input.context.keys);
	}
}

/**
 * Order rows so that every block's items are contiguous. A block takes the documentary slot
 * of its first descendant in the component, whatever the rank; rows are ordered top down, a
 * block spanning the previous row standing as a wall for its neighbors.
 */
function contiguousRows(
	rows: readonly (readonly string[])[],
	context: RowContext,
): readonly (readonly string[])[] {
	const { blocks, keys } = context;
	let previous: PreviousRow | undefined;
	return rows.map((row, rank) => {
		const containers = rowContainers(row, blocks);
		for (const items of containers.slots.values())
			items.sort((left, right) => defined(keys.get(left)) - defined(keys.get(right)));
		if (previous !== undefined)
			arrangeRow(containers, previous, { row, below: new Set(rows[rank + 1]), context });
		previous = { ids: new Set(row), containers };
		return expandSlots(containers.slots, containers.top);
	});
}

/** Documentary keys of items and blocks: a block takes its first descendant's key. */
function blockSlotKeys(
	ids: readonly string[],
	blocks: GroupBlocks,
	orderById: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
	const keys = new Map<string, number>();
	const lower = (id: string, key: number): boolean => {
		const known = keys.get(id);
		if (known !== undefined && known <= key) return false;
		keys.set(id, key);
		return true;
	};
	// Each key climbs only while it lowers a block key, so every block is lowered at most once
	// per smaller descendant key met in increasing order.
	for (const id of ids.toSorted(
		(left, right) => defined(orderById.get(left)) - defined(orderById.get(right)),
	)) {
		const key = defined(orderById.get(id));
		keys.set(id, key);
		for (let block = blocks.parentOf(id); block !== undefined; block = blocks.parentOf(block))
			if (!lower(block, key)) break;
	}
	return keys;
}

export function preparePlacementRows(input: {
	readonly ids: readonly string[];
	readonly orderById: ReadonlyMap<string, number>;
	readonly ranks: ReadonlyMap<string, number>;
	readonly junctionIds: ReadonlySet<string>;
	readonly maximumRank: number;
	readonly blocks: GroupBlocks;
	readonly relations: RowRelations;
}): PlacementRows {
	const { blocks } = input;
	// A block is drawn as its members' frame, not as a box in one row.
	const ids = input.ids.filter((id) => !blocks.ids.has(id));
	const rows = deriveEndpointRows({
		effectiveEndpointOrder: ids.toSorted(
			(left, right) => defined(input.orderById.get(left)) - defined(input.orderById.get(right)),
		),
		componentIds: ids,
		ranks: input.ranks,
		junctionIds: input.junctionIds,
		maximumRank: input.maximumRank,
	});
	if (!ids.some((id) => blocks.parentOf(id) !== undefined)) return rows;
	const keys = blockSlotKeys(
		ids.filter((id) => !input.junctionIds.has(id)),
		blocks,
		input.orderById,
	);
	return {
		ordinary: contiguousRows(rows.ordinary, { blocks, keys, relations: input.relations }),
		junction: rows.junction,
	};
}
