import { defined } from '../../document/logic-document';
import {
	type MutableBounds,
	translateTransversely,
	transverseCenter,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { ITEM_GAP } from '../layout-settings';
import type { PlacementRows } from '../structure/placement-rows';
import { alignFamilies, type BranchAlignment } from './align-families';
import {
	type BlockPlan,
	blockPlan,
	type ContainerPlan,
	type FamilyContext,
	gapBetween,
} from './block-plan';
import { fitRowAnchors } from './fit-row-anchors';
import { enclosure } from './group-enclosure';

interface Arrangement {
	readonly plan: BlockPlan;
	readonly context: FamilyContext;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
	readonly alignment?: BranchAlignment | undefined;
}

function moveItem(arrangement: Arrangement, item: string, shift: number): void {
	const { bounds, vertical, plan } = arrangement;
	translateTransversely(defined(bounds.get(item)), shift, vertical);
	for (const id of plan.contents.get(item) ?? [])
		translateTransversely(defined(bounds.get(id)), shift, vertical);
}

function sizeOf(arrangement: Arrangement, item: string): number {
	return transverseSize(defined(arrangement.bounds.get(item)), arrangement.vertical);
}

function rowSize(arrangement: Arrangement, row: readonly string[]): number {
	let total = 0;
	for (const [index, item] of row.entries()) {
		const previous = row[index - 1];
		if (previous !== undefined) total += gapBetween(arrangement.plan, previous, item);
		total += sizeOf(arrangement, item);
	}
	return total;
}

/**
 * Rows start centered and contiguous; a block keeps the position its first row gave it, and
 * the items of later rows fit around it in their order.
 */
function initialPlacement(arrangement: Arrangement, container: ContainerPlan): void {
	const { bounds, vertical } = arrangement;
	const placed = new Set<string>();
	const crossLength = Math.max(0, ...container.rows.map((row) => rowSize(arrangement, row)));
	for (const row of container.rows) {
		if (row.length === 0) continue;
		let cursor = (crossLength - rowSize(arrangement, row)) / 2;
		const items = row.map((item, index) => {
			const previous = row[index - 1];
			let gap = ITEM_GAP;
			if (previous !== undefined) gap = gapBetween(arrangement.plan, previous, item);
			if (previous !== undefined) cursor += gap;
			const size = sizeOf(arrangement, item);
			const contiguous = cursor + size / 2;
			cursor += size;
			if (!placed.has(item)) return { center: contiguous, size, fixed: false, gap };
			const center = transverseCenter(defined(bounds.get(item)), vertical);
			return { center, size, fixed: true, gap };
		});
		const centers = fitRowAnchors(items);
		for (const [index, item] of row.entries()) {
			const shift = defined(centers[index]) - transverseCenter(defined(bounds.get(item)), vertical);
			if (shift !== 0) moveItem(arrangement, item, shift);
			if (arrangement.plan.spans.has(item)) placed.add(item);
		}
	}
}

/** Push each item of a row after its predecessor; returns whether anything moved. */
function separateRow(arrangement: Arrangement, row: readonly string[]): boolean {
	const { bounds, vertical } = arrangement;
	let moved = false;
	let end = Number.NEGATIVE_INFINITY;
	for (const [index, item] of row.entries()) {
		const box = defined(bounds.get(item));
		const previous = row[index - 1];
		let gap = ITEM_GAP;
		if (previous !== undefined) gap = gapBetween(arrangement.plan, previous, item);
		const shift = end + gap - transverseStart(box, vertical);
		if (shift > 1e-9) {
			moveItem(arrangement, item, shift);
			moved = true;
		}
		end = transverseStart(box, vertical) + transverseSize(box, vertical);
	}
	return moved;
}

/** Keep every row ordered with the item gap; pushing a block moves it in all its rows. */
function separateRows(arrangement: Arrangement, container: ContainerPlan): void {
	const limit = container.rows.reduce((total, row) => total + row.length, 1);
	for (let pass = 0; pass < limit; pass += 1) {
		let moved = false;
		for (const row of container.rows) moved = separateRow(arrangement, row) || moved;
		if (!moved) return;
	}
}

function isWall(plan: BlockPlan, item: string, rank: number, sign: 1 | -1): boolean {
	const span = plan.spans.get(item);
	if (span === undefined) return false;
	if (sign > 0) return rank !== span.first;
	return rank !== span.last;
}

function arrangeContainer(arrangement: Arrangement, container: ContainerPlan): void {
	const { plan, bounds, vertical, context } = arrangement;
	initialPlacement(arrangement, container);
	alignFamilies({
		rows: container.rows,
		links: container.links,
		bounds,
		vertical,
		alignment: arrangement.alignment,
		isWall: (item, rank, sign) => isWall(plan, item, rank, sign),
		move: (item, shift) => {
			moveItem(arrangement, item, shift);
		},
		gapBetween: (left, right) => gapBetween(plan, left, right),
	});
	separateRows(arrangement, container);
	if (container.id === undefined) return;
	const members = (context.hierarchy?.membersById.get(container.id) ?? []).filter((id) =>
		bounds.has(id),
	);
	bounds.set(container.id, enclosure(defined(context.groups.get(container.id)), members, bounds));
}

/**
 * Lay out every block's interior first, then place it as one rigid item in the rows of its
 * container. Families are centered on their related endpoints inside the innermost container
 * holding both: a relation to a member aims at that member, a relation to a group at its frame.
 */
export function arrangeFamilies(input: {
	readonly rows: PlacementRows;
	readonly context: FamilyContext;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
	readonly alignment?: BranchAlignment | undefined;
}): void {
	const plan = blockPlan(input.rows, input.context);
	const arrangement = { ...input, plan };
	const [root] = plan.containers;
	if (plan.spans.size === 0 && root !== undefined) {
		alignFamilies({ ...input, rows: root.rows, links: root.links });
		return;
	}
	for (const container of plan.containers) arrangeContainer(arrangement, container);
}

/** Junction members of a block stay within its padding, where its frame already stands. */
export function clampBlockJunctions(input: {
	readonly rows: PlacementRows;
	readonly context: FamilyContext;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
}): void {
	const { rows, context, bounds, vertical } = input;
	const plan = blockPlan(rows, context);
	if (plan.spans.size === 0) return;
	for (const id of rows.junction.flat()) {
		const block = plan.blocks.chainOf(id).at(-1);
		if (block === undefined) continue;
		const frame = defined(bounds.get(block));
		const box = defined(bounds.get(id));
		const { padding, headerHeight } = defined(context.groups.get(block));
		let low = transverseStart(frame, vertical) + padding;
		if (!vertical) low += headerHeight;
		const high = transverseStart(frame, vertical) + transverseSize(frame, vertical) - padding;
		const size = transverseSize(box, vertical);
		const start = transverseStart(box, vertical);
		let target = Math.min(Math.max(start, low), high - size);
		const overflow = size - (high - low);
		if (overflow > 0) target = low - overflow / 2;
		if (target !== start) translateTransversely(box, target - start, vertical);
	}
}
