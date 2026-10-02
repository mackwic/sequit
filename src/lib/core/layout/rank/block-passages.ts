import type { LayoutStructure } from '../structure/prepare-layout';

export interface AdjacentRelation {
	readonly upper: string;
	readonly lower: string;
	/** Rank of the upper endpoint; the lower one is on the next rank. */
	readonly rank: number;
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
