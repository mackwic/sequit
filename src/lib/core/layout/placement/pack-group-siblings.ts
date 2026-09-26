import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import {
	mainSize,
	type MutableBounds,
	translateTransversely,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { ITEM_GAP } from '../layout-settings';

interface Item {
	readonly id: string;
	readonly box: MutableBounds;
	readonly group: boolean;
}

interface Span {
	readonly first: number;
	readonly last: number;
}

interface Tree {
	readonly maxima: number[];
	readonly covers: number[];
	readonly leafCount: number;
	readonly positions: ReadonlyMap<number, number>;
}

interface Update {
	readonly tree: Tree;
	readonly span: Span;
	readonly value: number;
}

interface Query {
	readonly tree: Tree;
	readonly span: Span;
}

function primaryStart(box: MutableBounds, vertical: boolean): number {
	if (vertical) return box.y;
	return box.x;
}

function spanOf(box: MutableBounds, vertical: boolean, tree: Tree): Span {
	const first = primaryStart(box, vertical);
	return {
		first: defined(tree.positions.get(first)),
		last: defined(tree.positions.get(first + mainSize(box, vertical))),
	};
}

function updateMax(position: number, low: number, high: number, update: Update): void {
	const { span, tree, value } = update;
	if (span.last <= low || high <= span.first) return;
	if (span.first <= low && high <= span.last) {
		tree.covers[position] = Math.max(defined(tree.covers[position]), value);
		tree.maxima[position] = Math.max(defined(tree.maxima[position]), value);
		return;
	}
	const middle = (low + high) >>> 1;
	updateMax(position * 2, low, middle, update);
	updateMax(position * 2 + 1, middle, high, update);
	const leftMaximum = defined(tree.maxima[position * 2]);
	const rightMaximum = defined(tree.maxima[position * 2 + 1]);
	tree.maxima[position] = Math.max(defined(tree.covers[position]), leftMaximum, rightMaximum);
}

function queryMax(position: number, low: number, high: number, query: Query): number {
	const { span, tree } = query;
	if (span.last <= low || high <= span.first) return Number.NEGATIVE_INFINITY;
	if (span.first <= low && high <= span.last) return defined(tree.maxima[position]);
	const value = defined(tree.covers[position]);
	const middle = (low + high) >>> 1;
	const left = queryMax(position * 2, low, middle, query);
	const right = queryMax(position * 2 + 1, middle, high, query);
	return Math.max(value, left, right);
}

function primaryOverlap(left: MutableBounds, right: MutableBounds, vertical: boolean): boolean {
	const first = primaryStart(left, vertical);
	const second = primaryStart(right, vertical);
	if (first + mainSize(left, vertical) <= second) return false;
	return second + mainSize(right, vertical) > first;
}

/** A group can pass a foreign sibling when that order is more compact. */
function preferGroupAfter(group: Item, other: Item, vertical: boolean): boolean {
	if (!group.group || other.group) return false;
	if (!primaryOverlap(group.box, other.box, vertical)) return false;
	const groupStart = transverseStart(group.box, vertical);
	const groupEnd = groupStart + transverseSize(group.box, vertical);
	const otherStart = transverseStart(other.box, vertical);
	const otherEnd = otherStart + transverseSize(other.box, vertical);
	if (groupEnd <= otherStart || otherEnd <= groupStart) return false;
	const shiftOther = groupEnd + ITEM_GAP - otherStart;
	const shiftGroup = otherEnd + ITEM_GAP - groupStart;
	const minimum = Math.min(groupStart, otherStart);
	const otherAfterWidth = Math.max(groupEnd, otherEnd + shiftOther) - minimum;
	const groupAfterWidth = Math.max(otherEnd, groupEnd + shiftGroup) - minimum;
	const groupAfterCost = groupAfterWidth + shiftGroup;
	const otherAfterCost = otherAfterWidth + shiftOther;
	return groupAfterCost < otherAfterCost;
}

function intervalTree(items: readonly Item[], vertical: boolean): Tree {
	const coordinates = [
		...new Set(
			items.flatMap(({ box }) => [
				primaryStart(box, vertical),
				primaryStart(box, vertical) + mainSize(box, vertical),
			]),
		),
	].sort((a, b) => a - b);
	let leafCount = 1;
	while (leafCount < coordinates.length - 1) leafCount *= 2;
	return {
		maxima: new Array<number>(leafCount * 2).fill(Number.NEGATIVE_INFINITY),
		covers: new Array<number>(leafCount * 2).fill(Number.NEGATIVE_INFINITY),
		leafCount,
		positions: new Map(coordinates.map((value, index) => [value, index])),
	};
}

/** Preserve already aligned distinct ranks and move only siblings with overlapping main spans. */
export function packGroupSiblings(
	children: readonly string[],
	bounds: ReadonlyMap<string, MutableBounds>,
	packing: {
		readonly groupIds: ReadonlyMap<string, unknown>;
		readonly pending: Map<string, number>;
	},
	vertical: boolean,
): void {
	const { groupIds, pending } = packing;
	const items: Item[] = children.map((id) => ({
		id,
		box: defined(bounds.get(id)),
		group: groupIds.has(id),
	}));
	items.sort(
		(left, right) =>
			transverseStart(left.box, vertical) - transverseStart(right.box, vertical) ||
			compareCanonicalStrings(left.id, right.id),
	);
	for (let index = 0; index < items.length - 1; index += 1) {
		const group = defined(items[index]);
		const other = defined(items[index + 1]);
		if (!preferGroupAfter(group, other, vertical)) continue;
		items[index] = other;
		items[index + 1] = group;
	}
	const tree = intervalTree(items, vertical);
	for (const { id, box } of items) {
		const span = spanOf(box, vertical, tree);
		const previousEnd = queryMax(1, 0, tree.leafCount, { tree, span });
		const start = transverseStart(box, vertical);
		const shift = Math.max(0, previousEnd + ITEM_GAP - start);
		if (shift > 0) {
			translateTransversely(box, shift, vertical);
			pending.set(id, (pending.get(id) ?? 0) + shift);
		}
		updateMax(1, 0, tree.leafCount, {
			tree,
			span,
			value: transverseStart(box, vertical) + transverseSize(box, vertical),
		});
	}
}
