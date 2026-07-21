import type { LayoutDirection } from '../document/logic-document';
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

export function layoutComponent(
	ids: readonly string[],
	ranks: ReadonlyMap<string, number>,
	sizes: ReadonlyMap<string, Size>,
	direction: LayoutDirection,
): ComponentLayout {
	const vertical = isVerticalDirection(direction);
	let maximumRank = 0;
	for (const id of ids) maximumRank = Math.max(maximumRank, ranks.get(id) ?? 0);
	const rows = Array.from({ length: maximumRank + 1 }, () => [] as string[]);
	for (const id of ids) rows[ranks.get(id) ?? 0]?.push(id);
	for (const row of rows) row.sort((left, right) => left.localeCompare(right));

	const primaryBandSizes = rows.map((row) => {
		let maximum = 1;
		for (const id of row) {
			const size = sizes.get(id);
			if (!size) throw new Error(`Missing measured size: ${id}`);
			maximum = Math.max(maximum, primarySize(size, vertical));
		}
		return maximum;
	});
	const primaryBandStarts = Array.from({ length: rows.length }, () => 0);
	for (let rank = 1; rank < rows.length; rank += 1) {
		primaryBandStarts[rank] =
			(primaryBandStarts[rank - 1] ?? 0) + (primaryBandSizes[rank - 1] ?? 0) + RANK_GAP;
	}
	const primaryLength =
		(primaryBandStarts[maximumRank] ?? 0) + (primaryBandSizes[maximumRank] ?? 0);
	const rowCrossSizes = rows.map((row) => {
		let total = 0;
		for (const id of row) {
			const size = sizes.get(id);
			if (!size) throw new Error(`Missing measured size: ${id}`);
			if (total > 0) total += ITEM_GAP;
			total += crossSize(size, vertical);
		}
		return total;
	});
	const crossLength = Math.max(1, ...rowCrossSizes);

	const boundsById = new Map<string, Bounds>();
	for (let rank = 0; rank < rows.length; rank += 1) {
		let cross = (crossLength - (rowCrossSizes[rank] ?? 0)) / 2;
		for (const id of rows[rank] ?? []) {
			const size = sizes.get(id);
			if (!size) throw new Error(`Missing measured size: ${id}`);
			const bandStart = primaryBandStarts[rank] ?? 0;
			const bandSize = primaryBandSizes[rank] ?? primarySize(size, vertical);
			const forwardPrimary = bandStart + (bandSize - primarySize(size, vertical)) / 2;
			const primary = isForwardDirection(direction)
				? forwardPrimary
				: primaryLength - forwardPrimary - primarySize(size, vertical);
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
