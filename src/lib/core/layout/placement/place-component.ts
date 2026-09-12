import { defined } from '../../document/logic-document';
import {
	boundsOnAxes,
	type LayoutFrame,
	mainSize,
	type MutableBounds,
	transverseSize,
} from '../geometry/layout-frame';
import { ITEM_GAP } from '../layout-settings';
import type { Size } from '../layout-types';
import type { PlacementRows } from '../structure/placement-rows';
import { centerRelatedRows } from './center-related-rows';
import { measureRows, type RowMetrics } from './row-metrics';

export interface ComponentLayout {
	readonly boundsById: Map<string, MutableBounds>;
	readonly width: number;
	readonly height: number;
}

export interface ComponentPlacementInput {
	readonly rows: PlacementRows;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly frame: LayoutFrame;
	readonly primaryBandSizes: readonly number[];
	readonly rankGap: number;
	readonly rankGaps: ReadonlyMap<number, number>;
	readonly parents: ReadonlyMap<string, readonly string[]> | undefined;
}

interface RowPlacement {
	readonly input: ComponentPlacementInput;
	readonly metrics: RowMetrics;
	readonly bounds: Map<string, MutableBounds>;
}

function alignedForwardOffset(bandSize: number, itemSize: number, frame: LayoutFrame): number {
	if (frame.forward === frame.biasAtStart) return 0;
	return bandSize - itemSize;
}

function place(id: string, cross: number, forwardPrimary: number, placement: RowPlacement): void {
	const { input, metrics, bounds } = placement;
	const size = defined(input.sizes.get(id));
	let primary = forwardPrimary;
	if (!input.frame.forward)
		primary = metrics.primaryLength - forwardPrimary - mainSize(size, input.frame.vertical);
	bounds.set(id, boundsOnAxes(cross, primary, size, input.frame.vertical));
}

function placeOrdinaryRows(placement: RowPlacement): void {
	const { input, metrics } = placement;
	const { vertical } = input.frame;
	for (const [rank, row] of input.rows.ordinary.entries()) {
		let cross = (metrics.crossLength - defined(metrics.ordinaryCrossSizes[rank])) / 2;
		for (const id of row) {
			const size = defined(input.sizes.get(id));
			const offset = alignedForwardOffset(
				defined(input.primaryBandSizes[rank]),
				mainSize(size, vertical),
				input.frame,
			);
			place(id, cross, defined(metrics.primaryBandStarts[rank]) + offset, placement);
			cross += transverseSize(size, vertical) + ITEM_GAP;
		}
	}
}

function placeJunctionRows(placement: RowPlacement): void {
	const { input, metrics } = placement;
	const { vertical } = input.frame;
	for (const [rank, row] of input.rows.junction.entries()) {
		let cross = (metrics.crossLength - defined(metrics.junctionCrossSizes[rank])) / 2;
		for (const id of row) {
			const size = defined(input.sizes.get(id));
			const junctionOffset = (defined(metrics.junctionSpans[rank]) - mainSize(size, vertical)) / 2;
			const bandEnd =
				defined(metrics.primaryBandStarts[rank]) + defined(input.primaryBandSizes[rank]);
			place(id, cross, bandEnd + junctionOffset, placement);
			cross += transverseSize(size, vertical) + ITEM_GAP;
		}
	}
}

export function placeComponent(input: ComponentPlacementInput): ComponentLayout {
	const { vertical } = input.frame;
	const metrics = measureRows(input);
	const bounds = new Map<string, MutableBounds>();
	const placement = { input, metrics, bounds };
	placeOrdinaryRows(placement);
	placeJunctionRows(placement);
	let crossLength = metrics.crossLength;
	if (input.parents !== undefined)
		crossLength = centerRelatedRows({
			rows: input.rows.ordinary,
			parents: input.parents,
			bounds,
			vertical,
		});
	if (vertical) return { boundsById: bounds, width: crossLength, height: metrics.primaryLength };
	return { boundsById: bounds, width: metrics.primaryLength, height: crossLength };
}
