import { defined } from '../../document/logic-document';
import {
	type MutableBounds,
	translateTransversely,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { ITEM_GAP } from '../layout-settings';
import { groupBlocks } from '../structure/group-blocks';
import type { PlacementRows } from '../structure/placement-rows';
import { type BlockPlan, blockPlan, type FamilyContext } from './block-plan';

function encloses(plan: BlockPlan, block: string, id: string): boolean {
	let parent = plan.blocks.parentOf(id);
	while (parent !== undefined && parent !== block) parent = plan.blocks.parentOf(parent);
	return parent === block;
}

/** Frames already placed: enough to keep junctions out of foreign ones. */
interface PlacedFrames {
	readonly plan: BlockPlan;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
}

function spansGap(span: { readonly first: number; readonly last: number }, interval: number) {
	return span.first <= interval && span.last > interval;
}

function interval(box: MutableBounds, vertical: boolean): { start: number; end: number } {
	const start = transverseStart(box, vertical);
	return { start, end: start + transverseSize(box, vertical) };
}

/**
 * A junction between two rows stays out of every foreign block spanning both: the frame is
 * continuous there. It moves to the nearer side, one item gap away.
 */
function leaveForeignFrames(arrangement: PlacedFrames, id: string, gap: number): void {
	const { plan, bounds, vertical } = arrangement;
	const box = defined(bounds.get(id));
	const walls = [...plan.spans]
		.filter(([block, span]) => spansGap(span, gap) && !encloses(plan, block, id))
		.map(([block]) => interval(defined(bounds.get(block)), vertical));
	for (let remaining = walls.length; remaining > 0; remaining -= 1) {
		const own = interval(box, vertical);
		const wall = walls.find(({ start, end }) => own.start < end && start < own.end);
		if (wall === undefined) return;
		const before = wall.start - ITEM_GAP - own.end;
		const after = wall.end + ITEM_GAP - own.start;
		let shift = after;
		if (-before < after) shift = before;
		translateTransversely(box, shift, vertical);
	}
}

/** Junction members of a block stay within its padding, where its frame already stands. */
export function clampBlockJunctions(input: {
	readonly rows: PlacementRows;
	readonly context: FamilyContext;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
}): void {
	const { rows, context, bounds, vertical } = input;
	if (groupBlocks(context.graph).ids.size === 0) return;
	const plan = blockPlan(rows, context);
	if (plan.spans.size === 0) return;
	for (const [interval, row] of rows.junction.entries())
		for (const id of row) leaveForeignFrames({ plan, bounds, vertical }, id, interval);
	for (const id of rows.junction.flat()) {
		const block = plan.blocks.parentOf(id);
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
