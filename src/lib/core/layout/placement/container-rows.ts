import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import { type GroupBlocks, rowContainers } from '../structure/group-blocks';
import type { PlacementRows } from '../structure/placement-rows';

export interface RankSpan {
	readonly first: number;
	readonly last: number;
}

/** The rows of one container, the root or a block, with the rank of each row. */
export interface ContainerRows {
	readonly ranks: readonly number[];
	readonly rows: readonly (readonly string[])[];
	/** Row index of a rank; a rank without a row holds nothing to arrange. */
	readonly indexOf: ReadonlyMap<number, number>;
}

export interface BlockSpans {
	readonly spans: ReadonlyMap<string, RankSpan>;
	/** The blocks of these rows, innermost first: a block is complete before its container. */
	readonly innermostFirst: readonly string[];
}

/** Rank spans of the blocks of some rows: each block extends its container's span once. */
export function blockSpans(rows: PlacementRows, blocks: GroupBlocks): BlockSpans {
	const spans = new Map<string, { first: number; last: number }>();
	const extend = (block: string, span: RankSpan): void => {
		const known = spans.get(block);
		if (known === undefined) spans.set(block, { ...span });
		else {
			known.first = Math.min(known.first, span.first);
			known.last = Math.max(known.last, span.last);
		}
	};
	for (const [rank, row] of rows.ordinary.entries())
		for (const id of row) {
			const block = blocks.parentOf(id);
			if (block !== undefined) extend(block, { first: rank, last: rank });
		}
	for (const block of [...spans.keys()])
		for (
			let parent = blocks.parentOf(block);
			parent !== undefined && !spans.has(parent);
			parent = blocks.parentOf(parent)
		)
			spans.set(parent, { first: Number.POSITIVE_INFINITY, last: Number.NEGATIVE_INFINITY });
	const innermostFirst = [...spans.keys()].sort(
		(left, right) =>
			blocks.depthOf(right) - blocks.depthOf(left) || compareCanonicalStrings(left, right),
	);
	for (const block of innermostFirst) {
		const parent = blocks.parentOf(block);
		if (parent !== undefined) extend(parent, defined(spans.get(block)));
	}
	return { spans, innermostFirst };
}

/**
 * Rows of every container: each endpoint stands for itself in its innermost block and for the
 * block enclosing it in every outer container. A container gets a row where it holds something
 * to arrange: one of its own endpoints, the first or last row of one of its blocks, or two
 * items. Elsewhere its only item is a block in the middle of its span, a wall in place.
 */
export function containerRowsOf(
	rows: PlacementRows,
	blocks: GroupBlocks,
	{ spans }: BlockSpans,
): ReadonlyMap<string | undefined, ContainerRows> {
	const result = new Map<
		string | undefined,
		{ ranks: number[]; rows: string[][]; indexOf: Map<number, number> }
	>();
	const add = (container: string | undefined, rank: number, items: string[]): void => {
		let known = result.get(container);
		if (known === undefined) {
			known = { ranks: [], rows: [], indexOf: new Map() };
			result.set(container, known);
		}
		if (known.indexOf.has(rank)) return;
		known.indexOf.set(rank, known.rows.length);
		known.ranks.push(rank);
		known.rows.push(items);
	};
	const bounding = new Map<number, string[]>();
	for (const [block, { first, last }] of spans)
		for (const rank of new Set([first, last])) {
			const list = bounding.get(rank) ?? [];
			list.push(block);
			bounding.set(rank, list);
		}
	for (const [rank, row] of rows.ordinary.entries()) {
		for (const [container, items] of rowContainers(row, blocks).slots) add(container, rank, items);
		for (const block of bounding.get(rank) ?? []) add(blocks.parentOf(block), rank, [block]);
	}
	return result;
}
