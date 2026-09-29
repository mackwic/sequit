import { defined } from '../../document/logic-document';
import { deriveEndpointRows, type EndpointRows } from '../../ordering/endpoint-order';
import type { GroupBlocks } from './group-blocks';

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
	const chains = new Map(row.map((id) => [id, [...blocks.chainOf(id), id]]));
	return row.toSorted((left, right) => {
		const leftChain = defined(chains.get(left));
		const rightChain = defined(chains.get(right));
		let depth = 0;
		while (leftChain[depth] === rightChain[depth]) depth += 1;
		return (
			defined(keys.get(defined(leftChain[depth]))) - defined(keys.get(defined(rightChain[depth])))
		);
	});
}

/** Documentary keys of items and blocks: a block takes its first descendant's key. */
function blockSlotKeys(
	ids: readonly string[],
	blocks: GroupBlocks,
	orderById: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
	const keys = new Map<string, number>();
	for (const id of ids) {
		const key = defined(orderById.get(id));
		keys.set(id, key);
		for (const block of blocks.chainOf(id)) keys.set(block, Math.min(keys.get(block) ?? key, key));
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
	if (!ids.some((id) => blocks.chainOf(id).length > 0)) return rows;
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
