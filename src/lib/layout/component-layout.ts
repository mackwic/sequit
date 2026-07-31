import { LayoutBias, LayoutDirection } from '../document/logic-document';
import type { EndpointRows } from './endpoint-order';
import type { Bounds, Size } from './layout-types';

const ITEM_GAP = 36;
const RANK_GAP = 72;
const JUNCTION_CLEARANCE = 18;

export interface ComponentLayout {
	readonly boundsById: ReadonlyMap<string, Bounds>;
	readonly width: number;
	readonly height: number;
}

export function isVerticalDirection(direction: LayoutDirection): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
}

function isForwardDirection(direction: LayoutDirection): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.LeftToRight;
}

function primarySize(size: Size, vertical: boolean): number {
	return vertical ? size.height : size.width;
}

function crossSize(size: Size, vertical: boolean): number {
	return vertical ? size.width : size.height;
}

function rowCrossSize(row: readonly string[], sizes: ReadonlyMap<string, Size>, vertical: boolean) {
	let total = 0;
	for (const id of row) {
		const size = sizes.get(id);
		if (!size) throw new Error(`Missing measured size: ${id}`);
		if (total > 0) total += ITEM_GAP;
		total += crossSize(size, vertical);
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
		if (!size) throw new Error(`Missing measured size: ${id}`);
		maximum = Math.max(maximum, primarySize(size, vertical));
	}
	return maximum;
}

function alignedForwardPrimaryOffset(
	bandSize: number,
	itemSize: number,
	direction: LayoutDirection,
	bias: LayoutBias,
): number {
	const biasAtPhysicalStart = bias === LayoutBias.Top || bias === LayoutBias.Left;
	const offsetAtForwardStart = isForwardDirection(direction)
		? biasAtPhysicalStart
		: !biasAtPhysicalStart;
	return offsetAtForwardStart ? 0 : bandSize - itemSize;
}

export function layoutComponent(
	rows: EndpointRows,
	sizes: ReadonlyMap<string, Size>,
	direction: LayoutDirection,
	bias: LayoutBias,
	primaryBandSizes: readonly number[],
	rankGap = RANK_GAP,
): ComponentLayout {
	const vertical = isVerticalDirection(direction);
	const maximumRank = Math.max(0, primaryBandSizes.length - 1);
	if (
		rows.ordinary.length !== primaryBandSizes.length ||
		rows.junction.length !== primaryBandSizes.length
	) {
		throw new Error('Component rows must align with primary rank bands');
	}
	const junctionPrimarySizes = rows.junction.map((row) => rowPrimarySize(row, sizes, vertical));
	const junctionSpans = junctionPrimarySizes.map((size, rank) => {
		if (size > 0) return Math.max(rankGap, size + JUNCTION_CLEARANCE * 2);
		return rank < maximumRank ? rankGap : 0;
	});
	const primaryBandStarts = Array.from({ length: primaryBandSizes.length }, () => 0);
	for (let rank = 1; rank < primaryBandSizes.length; rank += 1) {
		primaryBandStarts[rank] =
			(primaryBandStarts[rank - 1] ?? 0) +
			(primaryBandSizes[rank - 1] ?? 0) +
			(junctionSpans[rank - 1] ?? rankGap);
	}
	const primaryLength =
		(primaryBandStarts[maximumRank] ?? 0) +
		(primaryBandSizes[maximumRank] ?? 1) +
		(junctionSpans[maximumRank] ?? 0);
	const ordinaryCrossSizes = rows.ordinary.map((row) => rowCrossSize(row, sizes, vertical));
	const junctionCrossSizes = rows.junction.map((row) => rowCrossSize(row, sizes, vertical));
	const crossLength = Math.max(1, ...ordinaryCrossSizes, ...junctionCrossSizes);
	const boundsById = new Map<string, Bounds>();

	const place = (id: string, cross: number, forwardPrimary: number): void => {
		const size = sizes.get(id);
		if (!size) throw new Error(`Missing measured size: ${id}`);
		const itemPrimarySize = primarySize(size, vertical);
		const primary = isForwardDirection(direction)
			? forwardPrimary
			: primaryLength - forwardPrimary - itemPrimarySize;
		boundsById.set(
			id,
			vertical ? { x: cross, y: primary, ...size } : { x: primary, y: cross, ...size },
		);
	};

	for (const [rank, row] of rows.ordinary.entries()) {
		let cross = (crossLength - (ordinaryCrossSizes[rank] ?? 0)) / 2;
		for (const id of row) {
			const size = sizes.get(id);
			if (!size) throw new Error(`Missing measured size: ${id}`);
			const bandSize = primaryBandSizes[rank] ?? primarySize(size, vertical);
			place(
				id,
				cross,
				(primaryBandStarts[rank] ?? 0) +
					alignedForwardPrimaryOffset(bandSize, primarySize(size, vertical), direction, bias),
			);
			cross += crossSize(size, vertical) + ITEM_GAP;
		}
	}

	for (const [rank, row] of rows.junction.entries()) {
		let cross = (crossLength - (junctionCrossSizes[rank] ?? 0)) / 2;
		for (const id of row) {
			const size = sizes.get(id);
			if (!size) throw new Error(`Missing measured size: ${id}`);
			const itemPrimarySize = primarySize(size, vertical);
			const bandStart = primaryBandStarts[rank] ?? 0;
			const bandSize = primaryBandSizes[rank] ?? itemPrimarySize;
			const junctionSpan = junctionSpans[rank] ?? 0;
			const forwardPrimary = bandStart + bandSize + (junctionSpan - itemPrimarySize) / 2;
			place(id, cross, forwardPrimary);
			cross += crossSize(size, vertical) + ITEM_GAP;
		}
	}

	return {
		boundsById,
		width: vertical ? crossLength : primaryLength,
		height: vertical ? primaryLength : crossLength,
	};
}
