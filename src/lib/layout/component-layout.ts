import { LayoutBias, LayoutDirection } from '../document/logic-document';
import type { Bounds, Size } from './layout-types';

const ITEM_GAP = 36;
const RANK_GAP = 72;

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

interface PrimaryBandGeometry {
	readonly maximumRank: number;
	readonly effectiveBandSizes: readonly number[];
	readonly interBandGaps: readonly number[];
	readonly primaryBandStarts: readonly number[];
	readonly primaryLength: number;
}

function primaryBandGeometry(
	primaryBandSizes: readonly number[],
	junctionIds: ReadonlySet<string>,
	ranks: ReadonlyMap<string, number>,
	sizes: ReadonlyMap<string, Size>,
	vertical: boolean,
): PrimaryBandGeometry {
	const maximumRank = primaryBandSizes.length - 1;
	const junctionPrimarySizes = primaryBandSizes.map(() => 0);
	for (const id of junctionIds) {
		const rank = ranks.get(id) ?? 0;
		const current = requiredAt(junctionPrimarySizes, rank, 'junction primary size');
		junctionPrimarySizes[rank] = Math.max(current, primarySize(requiredSize(sizes, id), vertical));
	}
	const effectiveBandSizes = primaryBandSizes.map((size, rank) =>
		rank === maximumRank
			? Math.max(size, requiredAt(junctionPrimarySizes, rank, 'junction primary size'))
			: size,
	);
	const interBandGaps = primaryBandSizes.map((_, rank) =>
		rank < maximumRank
			? RANK_GAP + requiredAt(junctionPrimarySizes, rank, 'junction primary size')
			: 0,
	);
	const primaryBandStarts = effectiveBandSizes.map(() => 0);
	for (let rank = 1; rank < effectiveBandSizes.length; rank += 1) {
		primaryBandStarts[rank] =
			requiredAt(primaryBandStarts, rank - 1, 'primary band start') +
			requiredAt(effectiveBandSizes, rank - 1, 'primary band size') +
			requiredAt(interBandGaps, rank - 1, 'inter-band gap');
	}
	let primaryLength = 0;
	if (maximumRank >= 0) {
		primaryLength =
			requiredAt(primaryBandStarts, maximumRank, 'primary band start') +
			requiredAt(effectiveBandSizes, maximumRank, 'primary band size');
	}
	return {
		maximumRank,
		effectiveBandSizes,
		interBandGaps,
		primaryBandStarts,
		primaryLength,
	};
}

interface PlacementContext {
	readonly sizes: ReadonlyMap<string, Size>;
	readonly direction: LayoutDirection;
	readonly bias: LayoutBias;
	readonly vertical: boolean;
	readonly crossById: ReadonlyMap<string, number>;
	readonly geometry: PrimaryBandGeometry;
	readonly boundsById: Map<string, Bounds>;
}

function crossGeometry(
	ids: readonly string[],
	sizes: ReadonlyMap<string, Size>,
	vertical: boolean,
): { readonly byId: ReadonlyMap<string, number>; readonly length: number } {
	const byId = new Map<string, number>();
	let length = 0;
	for (const [index, id] of ids.entries()) {
		if (index > 0) length += ITEM_GAP;
		byId.set(id, length);
		length += crossSize(requiredSize(sizes, id), vertical);
	}
	return { byId, length: Math.max(1, length) };
}

function setBounds(context: PlacementContext, id: string, primary: number): void {
	const cross = context.crossById.get(id);
	if (cross === undefined) throw new Error(`Missing cross position: ${id}`);
	const size = requiredSize(context.sizes, id);
	context.boundsById.set(
		id,
		context.vertical ? { x: cross, y: primary, ...size } : { x: primary, y: cross, ...size },
	);
}

function placeRegularRows(rows: readonly (readonly string[])[], context: PlacementContext): void {
	const { effectiveBandSizes, primaryBandStarts, primaryLength } = context.geometry;
	for (const [rank, row] of rows.entries()) {
		for (const id of row) {
			const size = requiredSize(context.sizes, id);
			const bandStart = requiredAt(primaryBandStarts, rank, 'primary band start');
			const bandSize = requiredAt(effectiveBandSizes, rank, 'primary band size');
			const absoluteBandStart = isForwardDirection(context.direction)
				? bandStart
				: primaryLength - bandStart - bandSize;
			const alignAtStart = context.bias === LayoutBias.Top || context.bias === LayoutBias.Left;
			const primary =
				absoluteBandStart + (alignAtStart ? 0 : bandSize - primarySize(size, context.vertical));
			setBounds(context, id, primary);
		}
	}
}

function placeJunctionRows(rows: readonly (readonly string[])[], context: PlacementContext): void {
	const { maximumRank, effectiveBandSizes, interBandGaps, primaryBandStarts, primaryLength } =
		context.geometry;
	for (const [rank, row] of rows.entries()) {
		for (const id of row) {
			const size = requiredSize(context.sizes, id);
			const bandStart = requiredAt(primaryBandStarts, rank, 'primary band start');
			const bandSize = requiredAt(effectiveBandSizes, rank, 'primary band size');
			const sizeOnPrimaryAxis = primarySize(size, context.vertical);
			const forwardPrimary =
				rank < maximumRank
					? bandStart +
						bandSize +
						(requiredAt(interBandGaps, rank, 'inter-band gap') - sizeOnPrimaryAxis) / 2
					: bandStart + (bandSize - sizeOnPrimaryAxis) / 2;
			const primary = isForwardDirection(context.direction)
				? forwardPrimary
				: primaryLength - forwardPrimary - sizeOnPrimaryAxis;
			setBounds(context, id, primary);
		}
	}
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
	const geometry = primaryBandGeometry(primaryBandSizes, junctionIds, ranks, sizes, vertical);
	const cross = crossGeometry(ids, sizes, vertical);
	const boundsById = new Map<string, Bounds>();
	const context: PlacementContext = {
		sizes,
		direction,
		bias,
		vertical,
		crossById: cross.byId,
		geometry,
		boundsById,
	};
	placeRegularRows(rows, context);
	placeJunctionRows(junctionRows, context);
	return {
		boundsById,
		width: vertical ? cross.length : geometry.primaryLength,
		height: vertical ? geometry.primaryLength : cross.length,
	};
}
