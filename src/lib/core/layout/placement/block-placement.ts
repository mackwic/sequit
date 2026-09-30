import { defined } from '../../document/logic-document';
import {
	type MutableBounds,
	translateTransversely,
	transverseCenter,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { ITEM_GAP } from '../layout-settings';
import { groupBlocks } from '../structure/group-blocks';
import type { PlacementRows } from '../structure/placement-rows';
import { alignFamilies, type BranchAlignment } from './align-families';
import { arrangeOnce } from './arrangement-reuse';
import {
	type BlockPlan,
	blockPlan,
	type ContainerPlan,
	type FamilyContext,
	flatLinks,
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
	/** Shifts a moved block still owes its content; settled once every container is arranged. */
	readonly pending: Map<string, number>;
	/** The one box shifted reads are written to: envelopes read each box before the next. */
	readonly scratch: MutableBounds;
}

/** A block moves its frame now and its content later, so a move costs the same at any depth. */
function moveItem(arrangement: Arrangement, item: string, shift: number): void {
	const { bounds, vertical, plan, pending } = arrangement;
	translateTransversely(defined(bounds.get(item)), shift, vertical);
	if (plan.spans.has(item)) pending.set(item, (pending.get(item) ?? 0) + shift);
}

/**
 * Current bounds of an endpoint inside a container, including what its blocks still owe. A
 * shifted box is written to the arrangement's scratch box, valid until the next read.
 */
function currentBounds(
	arrangement: Arrangement,
	container: string | undefined,
	id: string,
): MutableBounds | undefined {
	const { bounds, plan, pending, vertical, scratch } = arrangement;
	const box = bounds.get(id);
	if (box === undefined || pending.size === 0) return box;
	let shift = 0;
	for (
		let block = plan.blocks.parentOf(id);
		block !== undefined && block !== container;
		block = plan.blocks.parentOf(block)
	)
		shift += pending.get(block) ?? 0;
	if (shift === 0) return box;
	scratch.x = box.x;
	scratch.y = box.y;
	scratch.width = box.width;
	scratch.height = box.height;
	translateTransversely(scratch, shift, vertical);
	return scratch;
}

/** Hand every owed shift down, outermost blocks first, to the items each block carries. */
function settlePending(arrangement: Arrangement): void {
	const { bounds, plan, pending, vertical } = arrangement;
	for (const container of plan.containers.toReversed()) {
		if (container.id === undefined) continue;
		const shift = pending.get(container.id) ?? 0;
		if (shift === 0) continue;
		for (const id of plan.children.get(container.id) ?? []) {
			translateTransversely(defined(bounds.get(id)), shift, vertical);
			if (plan.spans.has(id)) pending.set(id, (pending.get(id) ?? 0) + shift);
		}
	}
	pending.clear();
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
	const sizes = container.rows.map((row) => rowSize(arrangement, row));
	const crossLength = Math.max(0, ...sizes);
	for (const [rowIndex, row] of container.rows.entries()) {
		if (row.length === 0) continue;
		let cursor = (crossLength - defined(sizes[rowIndex])) / 2;
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
	const { plan, vertical } = arrangement;
	initialPlacement(arrangement, container);
	alignFamilies({
		rows: container.rows,
		links: container.links,
		bounds: { get: (id) => currentBounds(arrangement, container.id, id) },
		vertical,
		alignment: arrangement.alignment,
		isWall: (item, index, sign) => isWall(plan, item, defined(container.ranks[index]), sign),
		move: (item, shift) => {
			moveItem(arrangement, item, shift);
		},
		gapBetween: (left, right) => gapBetween(plan, left, right),
	});
	separateRows(arrangement, container);
	encloseContainer(arrangement, container);
}

/** The frame of a block around its members, as they now stand. */
function encloseContainer(arrangement: Arrangement, container: ContainerPlan): void {
	const { bounds, context } = arrangement;
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
	// Without any block, rows are flat: no plan, containers or frames to build.
	if (groupBlocks(input.context.graph).ids.size === 0) {
		alignFamilies({
			...input,
			rows: input.rows.ordinary,
			links: flatLinks(input.rows, input.context),
		});
		return;
	}
	const plan = blockPlan(input.rows, input.context);
	const arrangement = {
		...input,
		plan,
		pending: new Map<string, number>(),
		scratch: { x: 0, y: 0, width: 0, height: 0 },
	};
	const [root] = plan.containers;
	if (plan.spans.size === 0 && root !== undefined) {
		alignFamilies({ ...input, rows: root.rows, links: root.links });
		return;
	}
	arrangeOnce(input, {
		arrange: () => {
			for (const container of plan.containers) arrangeContainer(arrangement, container);
			settlePending(arrangement);
		},
		rebuildFrames: () => {
			for (const container of plan.containers) encloseContainer(arrangement, container);
		},
	});
}
