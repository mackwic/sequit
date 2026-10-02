import { defined } from '../../document/logic-document';
import { type LayoutFrame, mainSize } from '../geometry/layout-frame';
import { GROUP_FRAME_CLEARANCE } from '../layout-settings';
import type { GroupMeasurement, Size } from '../layout-types';
import type { LayoutStructure } from '../structure/prepare-layout';
import {
	compareRails,
	type GroupSpans,
	groupSpans,
	type RailPosition,
	type RailSpan,
	type RankSpan,
} from './group-spans';

export interface ShellContext {
	readonly structure: LayoutStructure;
	readonly frame: LayoutFrame;
	readonly groups: (id: string) => GroupMeasurement;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly bandSizes: readonly number[];
	/** Rank gap already required by other rules; frames are measured with at least this gap. */
	readonly minimumGap: number;
	/** Main length of the free groups beside each block's content, from its main start. */
	readonly freeLengths: ReadonlyMap<string, number>;
}

interface FrameRankGaps {
	/** Uniform rank gap holding every frame shell that begins or ends on a rank. */
	readonly rankGap: number;
	/**
	 * Rank gaps by interval exceeding the uniform one, holding the minimum-size overflow of
	 * frames spanning several ranks.
	 */
	readonly rankGaps: ReadonlyMap<number, number>;
}

export interface FrameShellGaps extends FrameRankGaps {
	/** Minimum channel gap by junction interval and slot, for frames ending on a junction rail. */
	readonly junctionGaps: ReadonlyMap<number, readonly number[]>;
}

interface Shells {
	readonly next: number;
	readonly previous: number;
}

/**
 * Header height a frame's shell adds toward the next and the previous rank. Headers stay
 * physically on top: on a horizontal main axis they are transverse and add nothing.
 */
function headerShells(frame: LayoutFrame, headerHeight: number): Shells {
	if (!frame.vertical) return { next: 0, previous: 0 };
	if (frame.forward) return { next: 0, previous: headerHeight };
	return { next: headerHeight, previous: 0 };
}

/**
 * Frame shells an endpoint's enclosing groups add toward the next and the previous rank. With
 * `rails`, a frame holding a junction rail beyond the rank neither ends nor starts on it.
 */
function boundaryShells(
	context: ShellContext,
	spans: ReadonlyMap<string, RankSpan>,
	input: {
		readonly id: string;
		readonly rank: number;
		readonly rails?: ReadonlyMap<string, RailSpan> | undefined;
	},
): Shells {
	const { structure, frame, groups } = context;
	let next = 0;
	let previous = 0;
	let ending = true;
	let starting = true;
	let groupId = structure.graph.endpointsById.get(input.id)?.entity.groupId;
	while (groupId !== undefined && (ending || starting)) {
		const span = defined(spans.get(groupId));
		const rails = input.rails?.get(groupId);
		// Rank r lies before interval r's rails, rank r + 1 after them.
		const endsOnRail = (rails?.last.interval ?? Number.NEGATIVE_INFINITY) >= input.rank;
		const startsOnRail = (rails?.first.interval ?? Number.POSITIVE_INFINITY) < input.rank;
		const { padding, headerHeight } = groups(groupId);
		const header = headerShells(frame, headerHeight);
		const endsHere = span.last === input.rank && !endsOnRail;
		const startsHere = span.first === input.rank && !startsOnRail;
		ending &&= endsHere;
		starting &&= startsHere;
		if (ending) next += padding + header.next;
		if (starting) previous += padding + header.previous;
		groupId = structure.hierarchy?.byId.get(groupId)?.groupId;
	}
	return { next, previous };
}

/**
 * Frame shells the ordinary boxes of each rank turn toward the next and the previous rank.
 * With `railAware`, a frame continuing to a junction rail neither ends nor starts on the rank.
 */
function rankShells(
	context: ShellContext,
	spans: GroupSpans,
	railAware: boolean,
): readonly Shells[] {
	const { structure } = context;
	let rails: ReadonlyMap<string, RailSpan> | undefined;
	if (railAware) rails = spans.rails;
	const base = Array.from({ length: structure.maximumRank + 1 }, () => ({ next: 0, previous: 0 }));
	for (const [id, rank] of structure.ranks.byEndpointId) {
		if (structure.junctionIds.has(id) || spans.ranks.has(id) || spans.rails.has(id)) continue;
		const shells = boundaryShells(context, spans.ranks, { id, rank, rails });
		const current = defined(base[rank]);
		base[rank] = {
			next: Math.max(current.next, shells.next),
			previous: Math.max(current.previous, shells.previous),
		};
	}
	return base;
}

/** Physical main start of every rank band, for one uniform rank gap. */
function bandStarts(context: ShellContext, gap: number): readonly number[] {
	const { bandSizes, frame } = context;
	const starts = Array.from({ length: bandSizes.length }, () => 0);
	let cursor = 0;
	for (let index = 0; index < bandSizes.length; index += 1) {
		let rank = bandSizes.length - 1 - index;
		if (frame.forward) rank = index;
		starts[rank] = cursor;
		cursor += defined(bandSizes[rank]) + gap;
	}
	return starts;
}

interface FrameExtent {
	/** Rank whose band the frame's physical bottom or right side follows. */
	readonly rank: number;
	/** Physical main extent of the frame. */
	readonly start: number;
	readonly end: number;
	/** Whether the frame spans several ranks and its content is shorter than its minimum size. */
	readonly short: boolean;
}

interface PlacedFrames {
	readonly nested: ReadonlyMap<string, FrameExtent>;
	readonly starts: readonly number[];
	readonly rails: ReadonlyMap<string, RailSpan>;
}

interface ExtentInput {
	readonly groupId: string;
	readonly span: RankSpan;
	/** Whether a frame spanning several ranks also grows to its minimum main size. */
	readonly spanning: boolean;
}

/**
 * A frame starts its header and padding before its first physical member and ends after its
 * padded content. It grows to its minimum main size physically down or right; without
 * `spanning`, only one-rank frames do. Junction members lie in rails and are reserved by
 * `junctionShellGaps`.
 */
function frameExtent(context: ShellContext, placed: PlacedFrames, input: ExtentInput): FrameExtent {
	const { structure, frame, sizes, bandSizes } = context;
	const { groupId, span } = input;
	const { padding, headerHeight, minimumWidth, minimumHeight } = context.groups(groupId);
	let first = Number.POSITIVE_INFINITY;
	let last = Number.NEGATIVE_INFINITY;
	for (const member of structure.hierarchy?.membersById.get(groupId) ?? []) {
		const inner = placed.nested.get(member);
		let rank = structure.ranks.byEndpointId.get(member);
		if (structure.junctionIds.has(member) || placed.rails.has(member)) rank = undefined;
		const size = sizes.get(member);
		if (inner !== undefined) {
			first = Math.min(first, inner.start);
			last = Math.max(last, inner.end);
		} else if (rank !== undefined && size !== undefined) {
			const length = mainSize(size, frame.vertical);
			let start = defined(placed.starts[rank]);
			if (!frame.biasAtStart) start += defined(bandSizes[rank]) - length;
			first = Math.min(first, start);
			last = Math.max(last, start + length);
		}
	}
	let minimum = minimumWidth;
	let header = 0;
	if (frame.vertical) {
		minimum = minimumHeight;
		header = headerHeight;
	}
	const spansRanks = span.first !== span.last;
	last = Math.max(last, first + (context.freeLengths.get(groupId) ?? Number.NEGATIVE_INFINITY));
	const start = first - padding - header;
	const contentEnd = last + padding;
	const short = spansRanks && start + minimum > contentEnd;
	if (spansRanks && !input.spanning) minimum = 0;
	let rank = span.first;
	if (frame.forward) rank = span.last;
	return { rank, start, end: Math.max(start + minimum, last + padding), short };
}

interface BoundaryShells {
	readonly spans: GroupSpans;
	readonly base: readonly Shells[];
	/** Uniform rank gap between the bands the frames are measured in. */
	readonly gap: number;
	readonly spanning: boolean;
	/** Whether a frame continuing to a rail beyond its far rank does not face that side. */
	readonly railAware: boolean;
}

interface RequiredGaps {
	/** Gap needed by the frame shells facing each other across each rank gap, zero if none. */
	readonly gaps: readonly number[];
	/** Whether a frame spanning several ranks is shorter than its minimum main size. */
	readonly short: boolean;
	/** Shells each rank turns toward the next and the previous rank, overflows included. */
	readonly facing: readonly Shells[];
}

/** Whether a frame continues past its far rank to a junction rail on its physical bottom or right. */
function continuesToRail(frame: LayoutFrame, span: RankSpan, rails: RailSpan | undefined): boolean {
	if (rails === undefined) return false;
	if (frame.forward) return rails.last.interval >= span.last;
	return rails.first.interval < span.first;
}

function requiredGaps(context: ShellContext, shells: BoundaryShells): RequiredGaps {
	const { structure, frame, bandSizes } = context;
	const starts = bandStarts(context, shells.gap);
	const next = shells.base.map(({ next: value }) => value);
	const previous = shells.base.map(({ previous: value }) => value);
	// The physical bottom or right side never carries the header.
	let far = previous;
	if (frame.forward) far = next;
	const nested = new Map<string, FrameExtent>();
	const placed = { nested, starts, rails: shells.spans.rails };
	const { spanning, railAware } = shells;
	let short = false;
	for (const [groupId, span] of shells.spans.ranks) {
		const extent = frameExtent(context, placed, { groupId, span, spanning });
		nested.set(groupId, extent);
		short ||= extent.short;
		if (railAware && continuesToRail(frame, span, shells.spans.rails.get(groupId))) continue;
		const bandEnd = defined(starts[extent.rank]) + defined(bandSizes[extent.rank]);
		far[extent.rank] = Math.max(defined(far[extent.rank]), extent.end - bandEnd);
	}
	const gaps = Array.from({ length: structure.maximumRank }, (_, rank) => {
		const facing = defined(next[rank]) + defined(previous[rank + 1]);
		if (facing > 0) return facing + GROUP_FRAME_CLEARANCE;
		return 0;
	});
	return {
		gaps,
		short,
		facing: next.map((value, rank) => ({ next: value, previous: defined(previous[rank]) })),
	};
}

/**
 * A frame ending on one rank faces the next rank's boxes: the gap holds the frame's padding,
 * its header when that side is physically on top, its minimum-size overflow on the physical
 * bottom or right, and a clearance before any foreign box. Every rank gap holds the shells
 * and one-rank overflows. The overflow of a frame spanning several ranks is measured with that
 * uniform gap inside the frame and reserved in the one gap it faces only: widening every gap
 * would also lengthen the frame's content, and would space every other rank for one frame.
 */
function frameBoundaryRankGaps(context: ShellContext, spans: GroupSpans): FrameRankGaps {
	const base = rankShells(context, spans, false);
	const shells = { spans, base, gap: context.minimumGap, spanning: false, railAware: false };
	const measured = requiredGaps(context, shells);
	const rankGap = measured.gaps.reduce((left, right) => Math.max(left, right), 0);
	const rankGaps = new Map<number, number>();
	// A wider gap only lengthens a frame's content: a frame long enough already cannot overflow.
	if (!measured.short) return { rankGap, rankGaps };
	const gap = Math.max(context.minimumGap, rankGap);
	const spanning = requiredGaps(context, { ...shells, gap, spanning: true }).gaps;
	for (const [rank, required] of spanning.entries())
		if (required > gap) rankGaps.set(rank, required);
	return { rankGap, rankGaps };
}

/** Shells grown physically down or right by `extent`, when positive. */
function growFar(frame: LayoutFrame, shells: Shells, extent: number): Shells {
	if (extent <= 0) return shells;
	if (frame.forward) return { ...shells, next: shells.next + extent };
	return { ...shells, previous: shells.previous + extent };
}

interface RailFrame {
	readonly shells: Shells;
	readonly starting: boolean;
	readonly ending: boolean;
}

/**
 * Adds one enclosing frame to the shells of a junction's rail, while the frames still begin or
 * end on it. A frame holding nothing but this rail holds its free groups from the content's
 * main start, then grows to its minimum main size, both physically down or right like a
 * one-rank frame.
 */
function railFrame(
	context: ShellContext,
	inner: RailFrame,
	input: {
		readonly spans: GroupSpans;
		readonly groupId: string;
		readonly rail: RailPosition;
		readonly length: number;
	},
): RailFrame {
	const { frame } = context;
	const { spans, groupId, rail, length } = input;
	const own = defined(spans.rails.get(groupId));
	const ranks = spans.ranks.get(groupId);
	const firstRank = ranks?.first ?? Number.POSITIVE_INFINITY;
	const lastRank = ranks?.last ?? Number.NEGATIVE_INFINITY;
	// Rank r lies before interval r's rails, rank r + 1 after them.
	const startsHere = compareRails(own.first, rail) === 0 && firstRank > rail.interval;
	const endsHere = compareRails(own.last, rail) === 0 && lastRank <= rail.interval;
	const starting = inner.starting && startsHere;
	const ending = inner.ending && endsHere;
	const alone = starting && ending && ranks === undefined;
	const { padding, headerHeight, minimumWidth, minimumHeight } = context.groups(groupId);
	const header = headerShells(frame, headerHeight);
	let { next, previous } = inner.shells;
	if (alone) {
		const free = context.freeLengths.get(groupId) ?? 0;
		const held = previous + next + length;
		({ next, previous } = growFar(frame, inner.shells, free - held));
	}
	if (starting) previous += padding + header.previous;
	if (ending) next += padding + header.next;
	const shells = { next, previous };
	let minimum = minimumWidth;
	if (frame.vertical) minimum = minimumHeight;
	const content = previous + next + length;
	if (alone) return { shells: growFar(frame, shells, minimum - content), starting, ending };
	return { shells, starting, ending };
}

/** Shells of the enclosing frames beginning or ending on a junction's rail, inside its gap. */
function junctionShells(
	context: ShellContext,
	spans: GroupSpans,
	input: { readonly id: string; readonly rail: RailPosition },
): Shells {
	const { structure, frame } = context;
	const length = mainSize(defined(context.sizes.get(input.id)), frame.vertical);
	let current: RailFrame = { shells: { next: 0, previous: 0 }, starting: true, ending: true };
	let groupId = structure.graph.endpointsById.get(input.id)?.entity.groupId;
	while (groupId !== undefined && (current.starting || current.ending)) {
		current = railFrame(context, current, { spans, groupId, rail: input.rail, length });
		groupId = structure.hierarchy?.byId.get(groupId)?.groupId;
	}
	return current.shells;
}

/**
 * A frame whose first or last member is a junction begins or ends on its rail. The channel
 * slot before or after that rail holds the frame's shell, the shell and minimum-size overflow
 * of any frame facing it from the neighbouring rank, and their clearance, whatever the channel
 * already reserves.
 */
function junctionShellGaps(
	context: ShellContext,
	spans: GroupSpans,
): ReadonlyMap<number, readonly number[]> {
	const { structure } = context;
	const result = new Map<number, number[]>();
	if (structure.junctions.size === 0) return result;
	// Rank r faces the first rail of interval r, rank r + 1 faces its last rail.
	const { facing } = requiredGaps(context, {
		spans,
		base: rankShells(context, spans, true),
		gap: context.minimumGap,
		spanning: false,
		railAware: true,
	});
	const lastDepths = new Map<number, number>();
	for (const { interval, depth } of structure.junctions.values())
		lastDepths.set(interval, Math.max(lastDepths.get(interval) ?? 0, depth));
	for (const [id, rail] of structure.junctions) {
		const shells = junctionShells(context, spans, { id, rail });
		let before = 0;
		let after = 0;
		if (rail.depth === 0) before = defined(facing[rail.interval]).next;
		if (rail.depth === lastDepths.get(rail.interval))
			after = facing[rail.interval + 1]?.previous ?? 0;
		const slots = result.get(rail.interval) ?? [];
		for (const [slot, shell, opposite] of [
			[rail.depth, shells.previous, before],
			[rail.depth + 1, shells.next, after],
		] as const) {
			if (shell === 0) continue;
			const required = shell + opposite + GROUP_FRAME_CLEARANCE;
			slots[slot] = Math.max(slots[slot] ?? 0, required);
		}
		if (slots.length > 0) result.set(rail.interval, slots);
	}
	return result;
}

/** Gaps every group frame shell needs, whether it ends on a rank or on a junction rail. */
export function frameShellGaps(context: ShellContext): FrameShellGaps {
	if (context.structure.hierarchy === undefined)
		return { rankGap: 0, rankGaps: new Map(), junctionGaps: new Map() };
	const spans = groupSpans(context.structure);
	return {
		...frameBoundaryRankGaps(context, spans),
		junctionGaps: junctionShellGaps(context, spans),
	};
}
