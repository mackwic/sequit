import { defined } from '../../document/logic-document';
import { deriveEndpointRows, type EndpointRows } from '../../ordering/endpoint-order';
import { expandSlots, type GroupBlocks, rowContainers } from './group-blocks';

/** Placement rows currently follow logical rank; junction rows occupy the following interval. */
export type PlacementRows = EndpointRows;

export interface RankedComponent {
	readonly ids: readonly string[];
	readonly context: string;
	readonly effectiveOrder: number;
	readonly rows: PlacementRows;
}

/**
 * Order one row so that every block's items are contiguous. A block takes the documentary slot
 * of its first descendant in the component, whatever the rank: sibling blocks keep one relative
 * order in every row they share.
 */
function contiguousRow(
	row: readonly string[],
	blocks: GroupBlocks,
	keys: ReadonlyMap<string, number>,
): readonly string[] {
	if (row.length < 2) return row;
	const { top, slots } = rowContainers(row, blocks);
	for (const items of slots.values())
		items.sort((left, right) => defined(keys.get(left)) - defined(keys.get(right)));
	return expandSlots(slots, top);
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
		ordinary: rows.ordinary.map((row) => contiguousRow(row, blocks, keys)),
		junction: rows.junction,
	};
}
