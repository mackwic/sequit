import { defined } from '../../document/logic-document';
import { transverseEnvelope } from '../geometry/envelope';
import {
	boundsOnAxes,
	type LayoutFrame,
	mainSize,
	type MutableBounds,
	translateTransversely,
	transverseSize,
} from '../geometry/layout-frame';
import { ITEM_GAP, JUNCTION_CLEARANCE } from '../layout-settings';
import type { Size } from '../layout-types';
import type { JunctionPlacement } from '../structure/junction-structure';
import type { PlacementRows } from '../structure/placement-rows';
import { alignComponentCenters } from './align-component-centers';
import { alignFamilies, type BranchAlignment, type FamilyAdjacency } from './align-families';
import { junctionCrossPositions, railSpan } from './junction-rails';
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
	readonly adjacency: FamilyAdjacency | undefined;
	readonly junctions?: ReadonlyMap<string, JunctionPlacement>;
	readonly channelGaps?: ReadonlyMap<number, readonly number[]> | undefined;
	readonly transverseCenters?: ReadonlyMap<string, number> | undefined;
	readonly branchAlignment?: BranchAlignment | undefined;
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
	for (const [rank, rails] of metrics.rails.entries()) {
		const bandEnd =
			defined(metrics.primaryBandStarts[rank]) + defined(input.primaryBandSizes[rank]);
		const gaps = input.channelGaps?.get(rank);
		const extra = (defined(metrics.junctionSpans[rank]) - railSpan(rails, gaps)) / 2;
		const leading = gaps?.[0] ?? JUNCTION_CLEARANCE;
		let primary = bandEnd + extra + leading;
		for (const [depth, rail] of rails.entries()) {
			const positions = junctionCrossPositions({
				rail,
				bounds: placement.bounds,
				junctions: input.junctions,
				vertical,
				crossLength: metrics.crossLength,
				sizes: input.sizes,
			});
			for (const id of rail.ids) {
				const size = defined(input.sizes.get(id));
				place(
					id,
					defined(positions.get(id)),
					primary + (rail.thickness - mainSize(size, vertical)) / 2,
					placement,
				);
			}
			const trailing = gaps?.[depth + 1] ?? JUNCTION_CLEARANCE;
			primary += rail.thickness + trailing;
		}
	}
}

/** Shift the component to start at zero on the transverse axis; returns its cross length. */
function normalizeTransversely(bounds: Map<string, MutableBounds>, vertical: boolean): number {
	const ids = [...bounds.keys()];
	if (ids.length === 0) return 1;
	const total = transverseEnvelope(ids, bounds, vertical);
	for (const box of bounds.values()) translateTransversely(box, -total.start, vertical);
	return total.end - total.start;
}

export function placeComponent(input: ComponentPlacementInput): ComponentLayout {
	const { vertical } = input.frame;
	const metrics = measureRows(input);
	const bounds = new Map<string, MutableBounds>();
	const placement = { input, metrics, bounds };
	placeOrdinaryRows(placement);
	const { adjacency } = input;
	if (adjacency !== undefined)
		alignFamilies({
			rows: input.rows.ordinary,
			adjacency,
			junctionIds: new Set(input.junctions?.keys()),
			bounds,
			vertical,
			alignment: input.branchAlignment,
		});
	placeJunctionRows(placement);
	let crossLength = metrics.crossLength;
	if (adjacency !== undefined) crossLength = normalizeTransversely(bounds, vertical);
	if (input.transverseCenters !== undefined)
		crossLength = alignComponentCenters(bounds, input.transverseCenters, vertical, crossLength);
	if (vertical) return { boundsById: bounds, width: crossLength, height: metrics.primaryLength };
	return { boundsById: bounds, width: metrics.primaryLength, height: crossLength };
}
