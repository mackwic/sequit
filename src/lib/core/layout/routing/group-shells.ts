import { defined } from '../../document/logic-document';
import { mainSize } from '../geometry/layout-frame';
import { GROUP_FRAME_CLEARANCE, RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';

/** An oriented interval on the main axis, with `start <= end`. */
export interface MainInterval {
	readonly start: number;
	readonly end: number;
}

/** The larger part of a free interval left beside a frame lying inside it. */
function besideFrame(free: MainInterval, frame: MainInterval): MainInterval {
	if (frame.end <= free.start || free.end <= frame.start) return free;
	if (frame.start - free.start >= free.end - frame.end)
		return { start: free.start, end: frame.start };
	return { start: frame.end, end: free.end };
}

/**
 * Clip gaps, sorted by start, to the space left by group frames: a frame beginning or ending
 * inside a gap takes its header, padding and minimum-size overflow out of that gap, and a frame
 * lying wholly inside a gap leaves its larger side. A frame spanning the whole gap leaves it
 * unchanged: the rail then runs inside that frame. Frames are sorted once; sweeps advance
 * monotonically.
 */
export function freeOfGroupShells(
	gaps: readonly MainInterval[],
	frames: readonly MainInterval[],
): readonly MainInterval[] {
	const byStart = frames.toSorted((left, right) => left.start - right.start);
	const byEnd = frames.toSorted((left, right) => left.end - right.end);
	let nextStart = 0;
	let nextEnd = 0;
	return gaps.map((gap) => {
		let { start, end } = gap;
		const inside: MainInterval[] = [];
		while ((byStart[nextStart]?.start ?? Number.POSITIVE_INFINITY) <= gap.start) nextStart += 1;
		for (let index = nextStart; index < byStart.length; index += 1) {
			const frame = defined(byStart[index]);
			if (frame.start >= gap.end) break;
			if (frame.end >= gap.end) end = Math.min(end, frame.start);
			else inside.push(frame);
		}
		while ((byEnd[nextEnd]?.end ?? Number.POSITIVE_INFINITY) <= gap.start) nextEnd += 1;
		for (let index = nextEnd; index < byEnd.length; index += 1) {
			const frame = defined(byEnd[index]);
			if (frame.end >= gap.end) break;
			if (frame.start <= gap.start) start = Math.max(start, frame.end);
		}
		return inside.reduce(besideFrame, { start, end });
	});
}

function mainInterval(box: Bounds, vertical: boolean): MainInterval {
	let start = box.x;
	if (vertical) start = box.y;
	return { start, end: start + mainSize(box, vertical) };
}

/** Physical main extent of each rank's boxes; frames and junction rails lie between rows. */
function rowIntervals(
	ranks: ReadonlyMap<string, number>,
	bounds: ReadonlyMap<string, Bounds>,
	input: {
		readonly frameIds: ReadonlySet<string>;
		readonly junctionIds: ReadonlySet<string>;
		readonly vertical: boolean;
	},
): ReadonlyMap<number, MainInterval> {
	const rows = new Map<number, MainInterval>();
	for (const [id, rank] of ranks) {
		const box = bounds.get(id);
		if (box === undefined || input.frameIds.has(id) || input.junctionIds.has(id)) continue;
		const own = mainInterval(box, input.vertical);
		const row = rows.get(rank) ?? own;
		rows.set(rank, { start: Math.min(row.start, own.start), end: Math.max(row.end, own.end) });
	}
	return rows;
}

/**
 * A channel bordered by group shells keeps its rails in the free part of its gap: that part
 * holds the frame clearance plus the spacing of every additional rail.
 */
export function shellChannelGaps(input: {
	readonly gaps: ReadonlyMap<number, number>;
	readonly railCounts: ReadonlyMap<number, number>;
	readonly ranks: ReadonlyMap<string, number>;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly frameIds: ReadonlySet<string>;
	readonly junctionIds: ReadonlySet<string>;
	readonly vertical: boolean;
}): ReadonlyMap<number, number> {
	const { bounds, vertical } = input;
	const frames = [...input.frameIds].flatMap((id) => {
		const box = bounds.get(id);
		if (box === undefined) return [];
		return [mainInterval(box, vertical)];
	});
	if (frames.length === 0) return input.gaps;
	const rows = rowIntervals(input.ranks, bounds, input);
	const channels: { rank: number; gap: number; span: MainInterval }[] = [];
	for (const [rank, gap] of input.gaps) {
		const before = rows.get(rank);
		const after = rows.get(rank + 1);
		if (before === undefined || after === undefined) continue;
		let span = { start: before.end, end: after.start };
		if (after.end <= before.start) span = { start: after.end, end: before.start };
		if (span.start < span.end) channels.push({ rank, gap, span });
	}
	channels.sort((left, right) => left.span.start - right.span.start);
	const free = freeOfGroupShells(
		channels.map(({ span }) => span),
		frames,
	);
	const result = new Map(input.gaps);
	for (const [index, { rank, gap, span }] of channels.entries()) {
		const clipped = defined(free[index]);
		const shells = span.end - span.start - (clipped.end - clipped.start);
		if (shells <= 0) continue;
		const rails = Math.max(0, (input.railCounts.get(rank) ?? 1) - 1) * RAIL_SPACING;
		result.set(rank, Math.max(gap, shells + GROUP_FRAME_CLEARANCE + rails));
	}
	return result;
}
