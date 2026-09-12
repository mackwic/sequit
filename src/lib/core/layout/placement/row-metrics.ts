import { defined } from '../../document/logic-document';
import { type LayoutFrame, mainSize, transverseSize } from '../geometry/layout-frame';
import { ITEM_GAP, JUNCTION_CLEARANCE } from '../layout-settings';
import type { Size } from '../layout-types';
import type { PlacementRows } from '../structure/placement-rows';

export interface RowMetrics {
	readonly primaryBandStarts: readonly number[];
	readonly junctionSpans: readonly number[];
	readonly ordinaryCrossSizes: readonly number[];
	readonly junctionCrossSizes: readonly number[];
	readonly primaryLength: number;
	readonly crossLength: number;
}

function rowCrossSize(
	row: readonly string[],
	sizes: ReadonlyMap<string, Size>,
	vertical: boolean,
): number {
	let total = 0;
	for (const id of row) {
		const size = sizes.get(id);
		if (size === undefined) throw new Error(`Missing measured size: ${id}`);
		if (total > 0) total += ITEM_GAP;
		total += transverseSize(size, vertical);
	}
	return total;
}

function rowPrimarySize(
	row: readonly string[],
	sizes: ReadonlyMap<string, Size>,
	vertical: boolean,
): number {
	let maximum = 0;
	for (const id of row) {
		const size = sizes.get(id);
		if (size === undefined) throw new Error(`Missing measured size: ${id}`);
		maximum = Math.max(maximum, mainSize(size, vertical));
	}
	return maximum;
}

export function measureRows(input: {
	readonly rows: PlacementRows;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly frame: LayoutFrame;
	readonly primaryBandSizes: readonly number[];
	readonly rankGap: number;
	readonly rankGaps: ReadonlyMap<number, number>;
}): RowMetrics {
	const { rows, sizes, primaryBandSizes, rankGaps, rankGap } = input;
	const { vertical } = input.frame;
	const maximumRank = Math.max(0, primaryBandSizes.length - 1);
	if (
		rows.ordinary.length !== primaryBandSizes.length ||
		rows.junction.length !== primaryBandSizes.length
	)
		throw new Error('Component rows must align with primary rank bands');
	const junctionSpans = rows.junction.map((row, rank) => {
		const size = rowPrimarySize(row, sizes, vertical);
		const gap = Math.max(rankGap, rankGaps.get(rank) ?? 0);
		if (size > 0) return Math.max(gap, size + JUNCTION_CLEARANCE * 2);
		if (rank < maximumRank) return gap;
		return 0;
	});
	const primaryBandStarts = Array.from({ length: primaryBandSizes.length }, () => 0);
	for (let rank = 1; rank < primaryBandSizes.length; rank += 1) {
		const previousEnd = defined(primaryBandStarts[rank - 1]) + defined(primaryBandSizes[rank - 1]);
		primaryBandStarts[rank] = previousEnd + defined(junctionSpans[rank - 1]);
	}
	const lastBandEnd =
		defined(primaryBandStarts[maximumRank]) + defined(primaryBandSizes[maximumRank]);
	const primaryLength = lastBandEnd + defined(junctionSpans[maximumRank]);
	const ordinaryCrossSizes = rows.ordinary.map((row) => rowCrossSize(row, sizes, vertical));
	const junctionCrossSizes = rows.junction.map((row) => rowCrossSize(row, sizes, vertical));
	return {
		primaryBandStarts,
		junctionSpans,
		primaryLength,
		ordinaryCrossSizes,
		junctionCrossSizes,
		crossLength: Math.max(1, ...ordinaryCrossSizes, ...junctionCrossSizes),
	};
}
