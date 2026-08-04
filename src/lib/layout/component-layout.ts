import type { LayoutBias, LayoutDirection } from '../document/logic-document';
import type { Bounds, Size } from './layout-types';

const ITEM_GAP = 36;
const RANK_GAP = 72;

export interface ComponentLayout {
	readonly boundsById: ReadonlyMap<string, Bounds>;
	readonly width: number;
	readonly height: number;
}

export function isVerticalDirection(direction: LayoutDirection): boolean {
	return direction === 'top-to-bottom' || direction === 'bottom-to-top';
}

function isForwardDirection(direction: LayoutDirection): boolean {
	return direction === 'top-to-bottom' || direction === 'left-to-right';
}

function primarySize(size: Size, vertical: boolean): number {
	return vertical ? size.height : size.width;
}

function crossSize(size: Size, vertical: boolean): number {
	return vertical ? size.width : size.height;
}

function requiredAt<T>(values: readonly T[], index: number, name: string): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Missing ${name}: ${index}`);
	return value;
}

function requiredSize(sizes: ReadonlyMap<string, Size>, id: string): Size {
	const size = sizes.get(id);
	if (!size) throw new Error(`Missing measured size: ${id}`);
	return size;
}

export function layoutComponent(
	ids: readonly string[],
	ranks: ReadonlyMap<string, number>,
	sizes: ReadonlyMap<string, Size>,
	direction: LayoutDirection,
	bias: LayoutBias,
	primaryBandSizes: readonly number[],
	junctionIds: ReadonlySet<string>,
): ComponentLayout {
	const vertical = isVerticalDirection(direction);
	const rows = primaryBandSizes.map(() => [] as string[]);
	const junctionRows = primaryBandSizes.map(() => [] as string[]);
	for (const id of ids) {
		const row = junctionIds.has(id) ? junctionRows : rows;
		requiredAt(row, ranks.get(id) ?? 0, 'layout rank').push(id);
	}
	for (const row of [...rows, ...junctionRows]) {
		row.sort((left, right) => left.localeCompare(right));
	}

	const primaryBandStarts = primaryBandSizes.map(() => 0);
	for (let rank = 1; rank < primaryBandSizes.length; rank += 1) {
		primaryBandStarts[rank] =
			requiredAt(primaryBandStarts, rank - 1, 'primary band start') +
			requiredAt(primaryBandSizes, rank - 1, 'primary band size') +
			RANK_GAP;
	}
	const maximumRank = primaryBandSizes.length - 1;
	const primaryLength =
		maximumRank < 0
			? 0
			: requiredAt(primaryBandStarts, maximumRank, 'primary band start') +
				requiredAt(primaryBandSizes, maximumRank, 'primary band size');
	const rowCrossSizes = rows.map((row) => {
		let total = 0;
		for (const id of row) {
			if (total > 0) total += ITEM_GAP;
			total += crossSize(requiredSize(sizes, id), vertical);
		}
		return total;
	});
	const junctionRowCrossSizes = junctionRows.map((row) => {
		let total = 0;
		for (const id of row) {
			if (total > 0) total += ITEM_GAP;
			total += crossSize(requiredSize(sizes, id), vertical);
		}
		return total;
	});
	const crossLength = Math.max(1, ...rowCrossSizes, ...junctionRowCrossSizes);

	const boundsById = new Map<string, Bounds>();
	for (const [rank, row] of rows.entries()) {
		let cross = (crossLength - requiredAt(rowCrossSizes, rank, 'row cross size')) / 2;
		for (const id of row) {
			const size = requiredSize(sizes, id);
			const bandStart = requiredAt(primaryBandStarts, rank, 'primary band start');
			const bandSize = requiredAt(primaryBandSizes, rank, 'primary band size');
			const absoluteBandStart = isForwardDirection(direction)
				? bandStart
				: primaryLength - bandStart - bandSize;
			const alignAtStart = bias === 'top' || bias === 'left';
			const primary =
				absoluteBandStart + (alignAtStart ? 0 : bandSize - primarySize(size, vertical));
			boundsById.set(
				id,
				vertical ? { x: cross, y: primary, ...size } : { x: primary, y: cross, ...size },
			);
			cross += crossSize(size, vertical) + ITEM_GAP;
		}
	}

	for (const [rank, row] of junctionRows.entries()) {
		let cross =
			(crossLength - requiredAt(junctionRowCrossSizes, rank, 'junction row cross size')) / 2;
		for (const id of row) {
			const size = requiredSize(sizes, id);
			const bandStart = requiredAt(primaryBandStarts, rank, 'primary band start');
			const bandSize = requiredAt(primaryBandSizes, rank, 'primary band size');
			const sizeOnPrimaryAxis = primarySize(size, vertical);
			const forwardPrimary =
				rank < maximumRank
					? bandStart + bandSize + (RANK_GAP - sizeOnPrimaryAxis) / 2
					: bandStart + (bandSize - sizeOnPrimaryAxis) / 2;
			const primary = isForwardDirection(direction)
				? forwardPrimary
				: primaryLength - forwardPrimary - sizeOnPrimaryAxis;
			boundsById.set(
				id,
				vertical ? { x: cross, y: primary, ...size } : { x: primary, y: cross, ...size },
			);
			cross += crossSize(size, vertical) + ITEM_GAP;
		}
	}

	return {
		boundsById,
		width: vertical ? crossLength : primaryLength,
		height: vertical ? primaryLength : crossLength,
	};
}
