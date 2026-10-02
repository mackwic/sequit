import { defined } from '../../document/logic-document';
import {
	mainSize,
	mainStart,
	type MutableBounds,
	translateTransversely,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { ITEM_GAP } from '../layout-settings';
import { groupBlocks } from '../structure/group-blocks';
import type { PlacementRows } from '../structure/placement-rows';
import { type BlockPlan, blockPlan, type FamilyContext } from './block-plan';
import { enclosure } from './group-enclosure';

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

function interval(box: MutableBounds, vertical: boolean): { start: number; end: number } {
	const start = transverseStart(box, vertical);
	return { start, end: start + transverseSize(box, vertical) };
}

/**
 * Whether a frame overlaps a junction along the flow: it spans the junction's gap, or its
 * shell, minimum size or own rails reach into the junction's rail.
 */
function reaches(frame: MutableBounds, junction: MutableBounds, vertical: boolean): boolean {
	const start = mainStart(junction, vertical);
	const end = start + mainSize(junction, vertical);
	const frameStart = mainStart(frame, vertical);
	const frameEnd = frameStart + mainSize(frame, vertical);
	return start < frameEnd && frameStart < end;
}

/**
 * A junction stays out of every foreign frame overlapping its rail along the flow. It moves to
 * the nearer side, one item gap away.
 */
function leaveForeignFrames(arrangement: PlacedFrames, id: string): void {
	const { plan, bounds, vertical } = arrangement;
	const box = defined(bounds.get(id));
	const walls = [...plan.spans.keys()]
		.filter((block) => !encloses(plan, block, id))
		.map((block) => defined(bounds.get(block)))
		.filter((frame) => reaches(frame, box, vertical))
		.map((frame) => interval(frame, vertical));
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

/** Junction members of each block, by rail: each run keeps its spacing along the rail. */
function junctionRuns(
	plan: BlockPlan,
	junctions: readonly string[],
	context: FamilyContext,
): ReadonlyMap<string, ReadonlyMap<string, readonly string[]>> {
	const runs = new Map<string, Map<string, string[]>>();
	for (const id of junctions) {
		const block = plan.blocks.parentOf(id);
		if (block === undefined) continue;
		const { interval, depth } = defined(context.junctions.get(id));
		const rails = runs.get(block) ?? new Map<string, string[]>();
		runs.set(block, rails);
		const rail = rails.get(`${interval}/${depth}`) ?? [];
		rail.push(id);
		rails.set(`${interval}/${depth}`, rail);
	}
	return runs;
}

/**
 * Junction members of a block stay within its padding, where its frame already stands. Those
 * on one rail move together, so none closes on another.
 */
function clampMembers(input: {
	readonly plan: BlockPlan;
	readonly junctions: readonly string[];
	readonly context: FamilyContext;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
}): void {
	const { plan, junctions, context, bounds, vertical } = input;
	for (const [block, rails] of junctionRuns(plan, junctions, context)) {
		const frame = defined(bounds.get(block));
		const { padding, headerHeight } = defined(context.groups.get(block));
		let low = transverseStart(frame, vertical) + padding;
		if (!vertical) low += headerHeight;
		const high = transverseStart(frame, vertical) + transverseSize(frame, vertical) - padding;
		for (const run of rails.values()) {
			const boxes = run.map((id) => defined(bounds.get(id)));
			const start = Math.min(...boxes.map((box) => transverseStart(box, vertical)));
			const end = Math.max(...boxes.map((box) => interval(box, vertical).end));
			let target = Math.min(Math.max(start, low), high - (end - start));
			const overflow = end - start - (high - low);
			if (overflow > 0) target = low - overflow / 2;
			for (const box of boxes) translateTransversely(box, target - start, vertical);
		}
	}
}

/**
 * Junction members of a block stay within its padding. Every frame then holds its junction
 * rails along the flow, and a foreign junction leaves each frame reaching its rail.
 */
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
	const junctions = rows.junction.flat();
	clampMembers({ plan, junctions, context, bounds, vertical });
	for (const { id } of plan.containers) {
		if (id === undefined) continue;
		const members = (context.hierarchy?.membersById.get(id) ?? []).filter((member) =>
			bounds.has(member),
		);
		bounds.set(id, enclosure(defined(context.groups.get(id)), members, bounds));
	}
	for (const id of junctions) leaveForeignFrames({ plan, bounds, vertical }, id);
}
