import { defined } from '../../document/logic-document';
import {
	mainSize,
	mainStart,
	type MutableBounds,
	translateTransversely,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { GROUP_FRAME_CLEARANCE, ITEM_GAP } from '../layout-settings';
import { groupBlocks } from '../structure/group-blocks';
import type { PlacementRows } from '../structure/placement-rows';
import { type BlockPlan, blockPlan, type FamilyContext } from './block-plan';
import { enclosure, type FrameReserve } from './group-enclosure';

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
 * Whether a frame reaches a junction's rail along the flow: it spans the junction's gap, or its
 * shell, minimum size or own rails come within half its clearance of the rail. A rail facing a
 * frame runs at least that far from it, in the middle of the clearance.
 */
function reaches(frame: MutableBounds, junction: MutableBounds, vertical: boolean): boolean {
	const start = mainStart(junction, vertical);
	const end = start + mainSize(junction, vertical);
	const reach = GROUP_FRAME_CLEARANCE / 2;
	const frameStart = mainStart(frame, vertical) - reach;
	const frameEnd = frameStart + mainSize(frame, vertical) + GROUP_FRAME_CLEARANCE;
	return start < frameEnd && frameStart < end;
}

/**
 * Junctions stay out of every foreign frame reaching their rail along the flow. They move to
 * the nearer side, one item gap away; a block's junctions on one rail move together, so none
 * closes on another.
 */
function leaveForeignFrames(arrangement: PlacedFrames, run: readonly string[]): void {
	const { plan, bounds, vertical } = arrangement;
	const boxes = run.map((id) => defined(bounds.get(id)));
	const [first] = run;
	const [box] = boxes;
	if (first === undefined || box === undefined) return;
	const walls = [...plan.spans.keys()]
		.filter((block) => !encloses(plan, block, first))
		.map((block) => defined(bounds.get(block)))
		.filter((frame) => reaches(frame, box, vertical))
		.map((frame) => interval(frame, vertical));
	for (let remaining = walls.length; remaining > 0; remaining -= 1) {
		const own = {
			start: Math.min(...boxes.map((member) => interval(member, vertical).start)),
			end: Math.max(...boxes.map((member) => interval(member, vertical).end)),
		};
		const wall = walls.find(({ start, end }) => own.start < end && start < own.end);
		if (wall === undefined) return;
		const before = wall.start - ITEM_GAP - own.end;
		const after = wall.end + ITEM_GAP - own.start;
		let shift = after;
		if (-before < after) shift = before;
		for (const member of boxes) translateTransversely(member, shift, vertical);
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
	readonly runs: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
	readonly context: FamilyContext;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
}): void {
	const { runs, context, bounds, vertical } = input;
	for (const [block, rails] of runs) {
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

/** Frames of the blocks around their members, row items and junctions as they now stand. */
function encloseBlocks(
	plan: BlockPlan,
	context: FamilyContext,
	junctions: readonly string[],
	bounds: Map<string, MutableBounds>,
): void {
	for (const { id } of plan.containers) {
		if (id === undefined) continue;
		const held = new Set([
			...(context.hierarchy?.membersById.get(id) ?? []),
			...(plan.children.get(id) ?? []),
			...junctions.filter((junction) => plan.blocks.parentOf(junction) === id),
		]);
		bounds.set(
			id,
			enclosure(
				defined(context.groups.get(id)),
				[...held].filter((member) => bounds.has(member)),
				bounds,
			),
		);
	}
}

/** How far each block's frame now reaches beyond the frame its rows were arranged with. */
function overflows(
	arranged: ReadonlyMap<string, MutableBounds>,
	bounds: ReadonlyMap<string, MutableBounds>,
	vertical: boolean,
): ReadonlyMap<string, FrameReserve> {
	const result = new Map<string, FrameReserve>();
	for (const [id, before] of arranged) {
		const after = interval(defined(bounds.get(id)), vertical);
		const { start, end } = interval(before, vertical);
		const reserve = {
			before: Math.max(0, start - after.start),
			after: Math.max(0, after.end - end),
		};
		if (reserve.before > 1e-9 || reserve.after > 1e-9) result.set(id, reserve);
	}
	return result;
}

/**
 * Junction members of a block stay within its padding. Every frame then holds its junction
 * rails along the flow, and a foreign junction leaves each frame reaching its rail. Returns the
 * room each block lacked for its junctions, where its frame outgrew the arranged one.
 */
export function clampBlockJunctions(input: {
	readonly rows: PlacementRows;
	readonly context: FamilyContext;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
}): ReadonlyMap<string, FrameReserve> {
	const { rows, context, bounds, vertical } = input;
	if (groupBlocks(context.graph).ids.size === 0) return new Map();
	const plan = blockPlan(rows, context);
	if (plan.spans.size === 0) return new Map();
	const junctions = rows.junction.flat();
	const arranged = new Map(
		[...plan.spans.keys()].map((id) => [id, { ...defined(bounds.get(id)) }] as const),
	);
	const runs = junctionRuns(plan, junctions, context);
	clampMembers({ runs, context, bounds, vertical });
	encloseBlocks(plan, context, junctions, bounds);
	for (const rails of runs.values())
		for (const run of rails.values()) leaveForeignFrames({ plan, bounds, vertical }, run);
	encloseBlocks(plan, context, junctions, bounds);
	// Junctions outside every block leave the frames as their own junctions finally hold them.
	for (const id of junctions)
		if (plan.blocks.parentOf(id) === undefined)
			leaveForeignFrames({ plan, bounds, vertical }, [id]);
	return overflows(arranged, bounds, vertical);
}
