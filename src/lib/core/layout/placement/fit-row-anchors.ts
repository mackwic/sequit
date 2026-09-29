import { defined } from '../../document/logic-document';
import { ITEM_GAP } from '../layout-settings';

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

/**
 * Fit an already ordered, non-overlapping row around a bounded selection of exact anchors.
 * Subtracting minimum center distances turns spacing into monotone coordinates. Clamping
 * the original coordinates between retained anchors then preserves every possible position.
 * Each anchor is pushed and popped at most once; the selection is deterministic, not optimal.
 */
export function fitRowAnchors(items: readonly RowAnchorItem[]): readonly number[] {
	const distances = minimumDistances(items);
	const anchors = selectAnchors(items, distances);
	const centers = items.map((item) => item.center);
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
		const distance = defined(distances[index]);
		const coordinate = item.center - distance;
		const upper = anchor?.coordinate ?? Number.POSITIVE_INFINITY;
		if (coordinate < lower) centers[index] = lower + distance;
		else if (coordinate > upper) centers[index] = upper + distance;
	}
	return centers;
}
