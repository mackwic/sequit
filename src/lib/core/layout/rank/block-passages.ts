import {
	commonContainer,
	type GroupBlocks,
	groupBlocks,
	type RowContainers,
	rowContainers,
} from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';

export interface AdjacentRelation {
	readonly upper: string;
	readonly lower: string;
	/** Rank of the upper endpoint; the lower one is on the next rank. */
	readonly rank: number;
}

interface RankSpan {
	first: number;
	last: number;
}

function adjacentPair(
	ranks: ReadonlyMap<string, number>,
	source: string,
	target: string,
): AdjacentRelation | undefined {
	const sourceRank = ranks.get(source);
	const targetRank = ranks.get(target);
	if (sourceRank === undefined || targetRank === undefined) return undefined;
	if (targetRank === sourceRank + 1) return { upper: source, lower: target, rank: sourceRank };
	if (sourceRank === targetRank + 1) return { upper: target, lower: source, rank: targetRank };
	return undefined;
}

/** Relations between ordinary endpoints of adjacent rows, members standing for their groups. */
export function adjacentRelations(structure: LayoutStructure): readonly AdjacentRelation[] {
	const ranks = structure.ranks.byEndpointId;
	return structure.graph.effectiveRelations.flatMap(({ sourceIds, targetIds }) =>
		sourceIds.flatMap((source) =>
			targetIds.flatMap((target) => adjacentPair(ranks, source, target) ?? []),
		),
	);
}

/** For each wall, whether it stands before `item` in the row. */
function sidesOf(items: readonly string[], item: string, walls: readonly string[]): string {
	const at = items.indexOf(item);
	return walls.map((wall) => Number(items.indexOf(wall) < at)).join('');
}

/** A relation whose endpoints a wall separates, and where its lower item has to stand. */
export interface ClosedPassage {
	readonly relation: AdjacentRelation;
	readonly container: string | undefined;
	/** The item standing for the lower endpoint in the container. */
	readonly item: string;
	/** Walls standing before the upper endpoint's item, then those after it. */
	readonly before: ReadonlySet<string>;
	readonly after: ReadonlySet<string>;
}

function closedPassage(
	relation: AdjacentRelation,
	blocks: GroupBlocks,
	rows: { readonly upper: RowContainers; readonly lower: RowContainers },
): ClosedPassage | undefined {
	const common = commonContainer(blocks, relation.upper, relation.lower);
	if (common === undefined) return undefined;
	const upper = rows.upper.slots.get(common.container);
	const lower = rows.lower.slots.get(common.container);
	if (upper === undefined || lower === undefined) return undefined;
	const endpoints = new Set([common.left, common.right]);
	const walls = upper.filter(
		(id) => blocks.ids.has(id) && !endpoints.has(id) && lower.includes(id),
	);
	if (walls.length === 0) return undefined;
	const side = sidesOf(upper, common.left, walls);
	if (side === sidesOf(lower, common.right, walls)) return undefined;
	const at = upper.indexOf(common.left);
	const before = walls.filter((wall) => upper.indexOf(wall) < at);
	return {
		relation,
		container: common.container,
		item: common.right,
		before: new Set(before),
		after: new Set(walls.filter((wall) => !before.includes(wall))),
	};
}

/**
 * A block present in two adjacent rows has one continuous frame between them: a relation whose
 * endpoints stand on different sides of it there cannot be routed, whatever the geometry.
 */
export function* closedPassages(
	structure: LayoutStructure,
	relations: readonly AdjacentRelation[],
): IterableIterator<ClosedPassage> {
	const blocks = groupBlocks(structure.graph);
	if (blocks.ids.size === 0) return;
	const rowOf = new Map<string, readonly string[]>();
	for (const component of structure.components)
		for (const row of component.rows.ordinary) for (const id of row) rowOf.set(id, row);
	const containers = new Map<readonly string[], RowContainers>();
	const containersOf = (row: readonly string[]): RowContainers => {
		const known = containers.get(row) ?? rowContainers(row, blocks);
		containers.set(row, known);
		return known;
	};
	for (const relation of relations) {
		const upperRow = rowOf.get(relation.upper);
		const lowerRow = rowOf.get(relation.lower);
		if (upperRow === undefined || lowerRow === undefined) continue;
		const rows = { upper: containersOf(upperRow), lower: containersOf(lowerRow) };
		const passage = closedPassage(relation, blocks, rows);
		if (passage !== undefined) yield passage;
	}
}

function extend(spans: Map<string, RankSpan>, block: string, span: RankSpan): void {
	const known = spans.get(block);
	if (known === undefined) {
		spans.set(block, { ...span });
		return;
	}
	known.first = Math.min(known.first, span.first);
	known.last = Math.max(known.last, span.last);
}

/** Rank spans of every block, from the ranks of the endpoints it holds, nested blocks first. */
function blockRankSpans(
	structure: LayoutStructure,
	blocks: GroupBlocks,
): ReadonlyMap<string, RankSpan> {
	const spans = new Map<string, RankSpan>();
	const rows = structure.components.flatMap(({ rows: { ordinary } }) => [...ordinary.entries()]);
	for (const [rank, row] of rows)
		for (const block of row.map((id) => blocks.parentOf(id)))
			if (block !== undefined) extend(spans, block, { first: rank, last: rank });
	const deepestFirst = [...spans.keys()].sort(
		(left, right) => blocks.depthOf(right) - blocks.depthOf(left),
	);
	for (const block of deepestFirst) {
		const parent = blocks.parentOf(block);
		const span = spans.get(block);
		if (parent !== undefined && span !== undefined) extend(spans, parent, span);
	}
	return spans;
}

/** Relations between two distinct items, by container and upper rank, then by both items. */
type DirectedCounts = Map<string, Map<string, Map<string, number>>>;

function countDirected(
	relations: readonly AdjacentRelation[],
	blocks: GroupBlocks,
	spans: ReadonlyMap<string, RankSpan>,
): DirectedCounts {
	const spansBoth = (item: string, rank: number): boolean => {
		const span = spans.get(item);
		if (span === undefined) return false;
		return span.first <= rank && span.last > rank;
	};
	const counts: DirectedCounts = new Map();
	for (const relation of relations) {
		const common = commonContainer(blocks, relation.upper, relation.lower);
		if (common === undefined) continue;
		if (!spansBoth(common.left, relation.rank) || !spansBoth(common.right, relation.rank)) continue;
		const place = `${common.container ?? ''}\u0000${relation.rank}`;
		const byUpper = counts.get(place) ?? new Map<string, Map<string, number>>();
		counts.set(place, byUpper);
		const byLower = byUpper.get(common.left) ?? new Map<string, number>();
		byUpper.set(common.left, byLower);
		byLower.set(common.right, (byLower.get(common.right) ?? 0) + 1);
	}
	return counts;
}

/** Pairs of relations joining the same two items in opposite directions. */
function opposedPairs(byUpper: ReadonlyMap<string, ReadonlyMap<string, number>>): number {
	let pairs = 0;
	for (const [upper, byLower] of byUpper)
		for (const [lower, count] of byLower)
			if (upper < lower) pairs += count * (byUpper.get(lower)?.get(upper) ?? 0);
	return pairs;
}

/**
 * Crossings no rank order can remove: two blocks of one container, both present in two
 * adjacent rows, joined by relations in both directions. Whatever their order, a relation
 * going down from the first to the second crosses every one going down from the second to
 * the first. Without blocks the bound is zero.
 */
export function forcedBlockCrossings(
	structure: LayoutStructure,
	relations: readonly AdjacentRelation[],
): number {
	const blocks = groupBlocks(structure.graph);
	if (blocks.ids.size === 0) return 0;
	const counts = countDirected(relations, blocks, blockRankSpans(structure, blocks));
	let forced = 0;
	for (const byUpper of counts.values()) forced += opposedPairs(byUpper);
	return forced;
}
