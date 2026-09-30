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

/** Items of a container row, the items related to each of them in the row above. */
export type RelatedAbove = (
	item: string,
	rank: number,
	container: string | undefined,
) => readonly string[];

interface MutableContainerRows {
	readonly ranks: number[];
	readonly rows: string[][];
	readonly indexOf: Map<number, number>;
}

/**
 * Where a wall goes in a row it has no member in: the split that keeps most items on the side
 * of the wall their related items take in the row above; without relations, its relative
 * position in that row.
 */
function wallIndex(
	wall: string,
	rows: { readonly above: readonly string[]; readonly items: readonly string[] },
	related: (item: string) => readonly string[],
): number {
	const { above, items } = rows;
	const wallAt = above.indexOf(wall);
	// -1 before the wall in the row above, +1 after it; items absent from it do not vote.
	const sideAbove = (id: string): number => {
		const at = above.indexOf(id);
		if (at < 0) return 0;
		return Math.sign(at - wallAt);
	};
	const votes = items.map((item) =>
		Math.sign(related(item).reduce((sum, id) => sum + sideAbove(id), 0)),
	);
	if (votes.every((vote) => vote === 0)) return Math.round((wallAt / above.length) * items.length);
	// Agreements when the wall goes before index k: items before it vote -1, items after +1.
	let agreements = votes.filter((vote) => vote > 0).length;
	let best = { index: 0, agreements };
	for (const [index, vote] of votes.entries()) {
		agreements -= Math.sign(vote);
		if (agreements > best.agreements) best = { index: index + 1, agreements };
	}
	return best.index;
}

/** Blocks of the row above still spanning this rank but without a member in this row. */
function holesIn(
	rows: { readonly above: readonly string[]; readonly items: readonly string[] },
	spans: ReadonlyMap<string, RankSpan>,
	rank: number,
): readonly string[] {
	return rows.above.filter((id) => {
		const last = spans.get(id)?.last;
		if (last === undefined || last <= rank) return false;
		return !rows.items.includes(id);
	});
}

/**
 * A block is a wall in every row of its container inside its span, even where it has no
 * member: insert it there, so no foreign item is placed inside its frame.
 */
function fillWallHoles(
	result: ReadonlyMap<string | undefined, MutableContainerRows>,
	spans: ReadonlyMap<string, RankSpan>,
	related: RelatedAbove,
): void {
	for (const [container, { ranks, rows }] of result)
		for (let index = 1; index < rows.length; index += 1) {
			const rank = defined(ranks[index]);
			const pair = { above: defined(rows[index - 1]), items: defined(rows[index]) };
			const relatedAt = (item: string) => related(item, rank, container);
			for (const wall of holesIn(pair, spans, rank))
				pair.items.splice(wallIndex(wall, pair, relatedAt), 0, wall);
		}
}

/**
 * Rows of every container: each endpoint stands for itself in its innermost block and for the
 * block enclosing it in every outer container. A container gets a row where it holds something
 * to arrange: one of its own endpoints, the first or last row of one of its blocks, or two
 * items. A block crossing a row of its container without a member there is inserted as a wall.
 */
export function containerRowsOf(
	rows: PlacementRows,
	blocks: GroupBlocks,
	{ spans }: BlockSpans,
	related: RelatedAbove,
): ReadonlyMap<string | undefined, ContainerRows> {
	const result = new Map<string | undefined, MutableContainerRows>();
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
	fillWallHoles(result, spans, related);
	return result;
}
