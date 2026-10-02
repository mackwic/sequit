import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import { type GroupBlocks, rowContainers } from '../structure/group-blocks';
import type { JunctionPlacement } from '../structure/junction-structure';
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
	/** Ranks each block's frame stands in, up to the rails of its junctions. */
	readonly spans: ReadonlyMap<string, RankSpan>;
	/** Ranks holding a member of each block, nested blocks included. */
	readonly occupied: ReadonlyMap<string, RankSpan>;
	/** The blocks of these rows, innermost first: a block is complete before its container. */
	readonly innermostFirst: readonly string[];
}

type SpanSeed = readonly [block: string, span: RankSpan];

/**
 * Ranks each row item gives its innermost block. With `junctions`, a rail does too: rail r lies
 * between ranks r and r + 1, so a frame before it spans rank r, and one after it rank r + 1.
 */
function spanSeeds(
	rows: PlacementRows,
	blocks: GroupBlocks,
	junctions: ReadonlyMap<string, JunctionPlacement> | undefined,
): readonly SpanSeed[] {
	const seeds: SpanSeed[] = [];
	for (const [rank, row] of rows.ordinary.entries())
		for (const id of row) {
			const block = blocks.parentOf(id);
			if (block !== undefined) seeds.push([block, { first: rank, last: rank }]);
		}
	for (const id of rows.junction.flat()) {
		const block = blocks.parentOf(id);
		const interval = junctions?.get(id)?.interval;
		if (block !== undefined && interval !== undefined)
			seeds.push([block, { first: interval + 1, last: interval }]);
	}
	return seeds;
}

/** Rank spans of the blocks of some rows: each block extends its container's span once. */
function spansOf(
	seeds: readonly SpanSeed[],
	blocks: GroupBlocks,
): { readonly spans: Map<string, RankSpan>; readonly innermostFirst: readonly string[] } {
	const spans = new Map<string, { first: number; last: number }>();
	const extend = (block: string, span: RankSpan): void => {
		const known = spans.get(block);
		if (known === undefined) spans.set(block, { ...span });
		else {
			known.first = Math.min(known.first, span.first);
			known.last = Math.max(known.last, span.last);
		}
	};
	for (const [block, span] of seeds) extend(block, span);
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
 * Rank spans of the blocks of some rows. A frame reaching the rail of one of its junctions also
 * stands in every rank before that rail, where it may hold no member.
 */
export function blockSpans(
	rows: PlacementRows,
	blocks: GroupBlocks,
	junctions: ReadonlyMap<string, JunctionPlacement>,
): BlockSpans {
	const { spans, innermostFirst } = spansOf(spanSeeds(rows, blocks, junctions), blocks);
	const occupied = spansOf(spanSeeds(rows, blocks, undefined), blocks).spans;
	return { spans, occupied, innermostFirst };
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

/** Blocks of a neighbouring row whose span covers this rank but without a member in this row. */
function holesIn(
	rows: { readonly above: readonly string[]; readonly items: readonly string[] },
	spans: ReadonlyMap<string, RankSpan>,
	rank: number,
): readonly string[] {
	return rows.above.filter((id) => {
		const span = spans.get(id);
		if (span === undefined || rows.items.includes(id)) return false;
		return span.first <= rank && rank <= span.last;
	});
}

/**
 * A block is a wall in every row of its container inside its span, even where it has no
 * member: insert it there, so no foreign item is placed inside its frame. Its frame reaches
 * these rows from the row above, or from the row below up to the rail of one of its junctions.
 */
function fillWallHoles(
	result: ReadonlyMap<string | undefined, MutableContainerRows>,
	spans: ReadonlyMap<string, RankSpan>,
	related: RelatedAbove,
): void {
	for (const [container, { ranks, rows }] of result) {
		const fill = (index: number, neighbour: number): void => {
			const rank = defined(ranks[index]);
			const pair = { above: defined(rows[neighbour]), items: defined(rows[index]) };
			const relatedAt = (item: string) => related(item, rank, container);
			for (const wall of holesIn(pair, spans, rank))
				pair.items.splice(wallIndex(wall, pair, relatedAt), 0, wall);
		};
		for (let index = 1; index < rows.length; index += 1) fill(index, index - 1);
		for (let index = rows.length - 2; index >= 0; index -= 1) fill(index, index + 1);
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
	{ spans, occupied }: BlockSpans,
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
	for (const [block, { first, last }] of occupied)
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
