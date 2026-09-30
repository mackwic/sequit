import { defined } from '../../document/logic-document';
import type { Interval } from '../geometry/envelope';
import { ITEM_GAP, RAIL_SPACING } from '../layout-settings';

export interface RowAnchorItem {
	readonly center: number;
	readonly size: number;
	readonly target?: number;
	readonly fixed: boolean;
	/** Free space before this item, after the previous one; the item gap by default. */
	readonly gap?: number | undefined;
}

interface RowAnchor {
	readonly index: number;
	readonly center: number;
	readonly coordinate: number;
	readonly displacement: number;
	readonly fixed: boolean;
}

function minimumDistances(items: readonly RowAnchorItem[]): readonly number[] {
	const distances: number[] = [];
	let distance = 0;
	for (const [index, item] of items.entries()) {
		if (index > 0) {
			const previous = defined(items[index - 1]);
			const halfSizes = (previous.size + item.size) / 2;
			distance += halfSizes + (item.gap ?? ITEM_GAP);
		}
		distances.push(distance);
	}
	return distances;
}

function preferred(left: RowAnchor, right: RowAnchor): boolean {
	if (left.fixed !== right.fixed) return left.fixed;
	return left.displacement <= right.displacement;
}

function appendAnchor(anchors: RowAnchor[], candidate: RowAnchor): void {
	let previous = anchors.at(-1);
	while (previous !== undefined && previous.coordinate > candidate.coordinate) {
		if (preferred(previous, candidate)) return;
		anchors.pop();
		previous = anchors.at(-1);
	}
	anchors.push(candidate);
}

function selectAnchors(
	items: readonly RowAnchorItem[],
	distances: readonly number[],
): readonly RowAnchor[] {
	const anchors: RowAnchor[] = [];
	for (const [index, item] of items.entries()) {
		let center = item.target;
		if (item.fixed) center = item.center;
		if (center === undefined) continue;
		appendAnchor(anchors, {
			index,
			center,
			coordinate: center - defined(distances[index]),
			displacement: Math.abs(center - item.center),
			fixed: item.fixed,
		});
	}
	return anchors;
}

interface SlideRow {
	readonly items: readonly RowAnchorItem[];
	readonly centers: number[];
	/** Transverse spans of the long relations crossing the row, between their endpoints. */
	readonly passages: readonly Interval[];
}

/**
 * Minimum distance a slide leaves between the centers of an item and the one before it. A
 * long relation spanning part of their current free space may be routed there: each such
 * passage needs its own track, a rail spacing from both boxes and from the other tracks.
 */
function spacing(row: SlideRow, index: number): number {
	const previous = defined(row.items[index - 1]);
	const item = defined(row.items[index]);
	const start = defined(row.centers[index - 1]) + previous.size / 2;
	const end = defined(row.centers[index]) - item.size / 2;
	let crossing = 0;
	for (const passage of row.passages)
		if (passage.start <= end && passage.end >= start) crossing += 1;
	let free = item.gap ?? ITEM_GAP;
	if (crossing > 0) free = Math.max(free, (crossing + 1) * RAIL_SPACING);
	return (previous.size + item.size) / 2 + free;
}

/**
 * Move every item whose target lost a conflict as close to that target as its current
 * neighbors and passages allow, without pushing them. Items moving forward settle from the
 * end, so each meets its final forward neighbor; items moving backward then settle from the
 * start. No item moves away from its target, even beside a passage already too narrow.
 */
function slideTowardTargets(row: SlideRow, sliders: readonly number[]): void {
	const { items, centers } = row;
	for (const index of sliders.toReversed()) {
		const wanted = defined(items[index]?.target);
		const current = defined(centers[index]);
		const next = centers[index + 1];
		if (wanted <= current) continue;
		let limit = Number.POSITIVE_INFINITY;
		if (next !== undefined) limit = next - spacing(row, index + 1);
		centers[index] = Math.max(current, Math.min(wanted, limit));
	}
	for (const index of sliders) {
		const wanted = defined(items[index]?.target);
		const current = defined(centers[index]);
		const previous = centers[index - 1];
		if (wanted >= current) continue;
		let limit = Number.NEGATIVE_INFINITY;
		if (previous !== undefined) limit = previous + spacing(row, index);
		centers[index] = Math.min(current, Math.max(wanted, limit));
	}
}

/**
 * Fit an already ordered, non-overlapping row around a bounded selection of exact anchors.
 * Subtracting minimum center distances turns spacing into monotone coordinates. Clamping
 * the original coordinates between retained anchors then preserves every possible position.
 * Given the passages of the long relations crossing the row, resolved only when needed, an
 * item whose target conflicts with a retained anchor finally slides against its obstacle.
 * Each anchor is pushed and popped at most once; the selection is deterministic, not optimal.
 */
export function fitRowAnchors(
	items: readonly RowAnchorItem[],
	passages?: () => readonly Interval[],
): readonly number[] {
	const distances = minimumDistances(items);
	const anchors = selectAnchors(items, distances);
	const centers = items.map((item) => item.center);
	const sliders: number[] = [];
	let lower = Number.NEGATIVE_INFINITY;
	let next = 0;
	for (const [index, item] of items.entries()) {
		const anchor = anchors[next];
		if (anchor?.index === index) {
			centers[index] = anchor.center;
			lower = anchor.coordinate;
			next += 1;
			continue;
		}
		if (!item.fixed && item.target !== undefined) sliders.push(index);
		const distance = defined(distances[index]);
		const coordinate = item.center - distance;
		const upper = anchor?.coordinate ?? Number.POSITIVE_INFINITY;
		if (coordinate < lower) centers[index] = lower + distance;
		else if (coordinate > upper) centers[index] = upper + distance;
	}
	if (passages !== undefined && sliders.length > 0)
		slideTowardTargets({ items, centers, passages: passages() }, sliders);
	return centers;
}
