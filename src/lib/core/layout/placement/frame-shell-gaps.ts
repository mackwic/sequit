import { defined } from '../../document/logic-document';
import { type LayoutFrame, mainSize } from '../geometry/layout-frame';
import { GROUP_FRAME_CLEARANCE } from '../layout-settings';
import type { GroupMeasurement, Size } from '../layout-types';
import type { LayoutStructure } from '../structure/prepare-layout';

interface RankSpan {
	readonly first: number;
	readonly last: number;
}

export interface ShellContext {
	readonly structure: LayoutStructure;
	readonly frame: LayoutFrame;
	readonly groups: (id: string) => GroupMeasurement;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly bandSizes: readonly number[];
	/** Rank gap already required by other rules; frames are measured with at least this gap. */
	readonly minimumGap: number;
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

/** Ranks covered by each populated group, from its ranked members and nested groups. */
function groupRankSpans(structure: LayoutStructure): ReadonlyMap<string, RankSpan> {
	const spans = new Map<string, RankSpan>();
	for (const group of structure.hierarchy?.deepestFirst ?? []) {
		let first = Number.POSITIVE_INFINITY;
		let last = Number.NEGATIVE_INFINITY;
		for (const member of structure.hierarchy?.membersById.get(group.id) ?? []) {
			if (structure.junctionIds.has(member)) continue;
			const rank = structure.ranks.byEndpointId.get(member);
			let span = spans.get(member);
			if (span === undefined && rank !== undefined) span = { first: rank, last: rank };
			if (span === undefined) continue;
			first = Math.min(first, span.first);
			last = Math.max(last, span.last);
		}
		if (first <= last) spans.set(group.id, { first, last });
	}
	return spans;
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

/** Frame shells the ordinary boxes of each rank turn toward the next and the previous rank. */
function rankShells(
	context: ShellContext,
	spans: ReadonlyMap<string, RankSpan>,
	rails?: ReadonlyMap<string, RailSpan>,
): readonly Shells[] {
	const { structure } = context;
	const base = Array.from({ length: structure.maximumRank + 1 }, () => ({ next: 0, previous: 0 }));
	for (const [id, rank] of structure.ranks.byEndpointId) {
		if (structure.junctionIds.has(id) || spans.has(id)) continue;
		const shells = boundaryShells(context, spans, { id, rank, rails });
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
		if (structure.junctionIds.has(member)) rank = undefined;
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
	const start = first - padding - header;
	const contentEnd = last + padding;
	const short = spansRanks && start + minimum > contentEnd;
	if (spansRanks && !input.spanning) minimum = 0;
	let rank = span.first;
	if (frame.forward) rank = span.last;
	return { rank, start, end: Math.max(start + minimum, last + padding), short };
}

interface BoundaryShells {
	readonly spans: ReadonlyMap<string, RankSpan>;
	readonly base: readonly Shells[];
	/** Uniform rank gap between the bands the frames are measured in. */
	readonly gap: number;
	readonly spanning: boolean;
}

interface RequiredGaps {
	/** Gap needed by the frame shells facing each other across each rank gap, zero if none. */
	readonly gaps: readonly number[];
	/** Whether a frame spanning several ranks is shorter than its minimum main size. */
	readonly short: boolean;
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
	const placed = { nested, starts };
	const { spanning } = shells;
	let short = false;
	for (const [groupId, span] of shells.spans) {
		const extent = frameExtent(context, placed, { groupId, span, spanning });
		nested.set(groupId, extent);
		short ||= extent.short;
		const bandEnd = defined(starts[extent.rank]) + defined(bandSizes[extent.rank]);
		far[extent.rank] = Math.max(defined(far[extent.rank]), extent.end - bandEnd);
	}
	const gaps = Array.from({ length: structure.maximumRank }, (_, rank) => {
		const facing = defined(next[rank]) + defined(previous[rank + 1]);
		if (facing > 0) return facing + GROUP_FRAME_CLEARANCE;
		return 0;
	});
	return { gaps, short };
}

/**
 * A frame ending on one rank faces the next rank's boxes: the gap holds the frame's padding,
 * its header when that side is physically on top, its minimum-size overflow on the physical
 * bottom or right, and a clearance before any foreign box. Every rank gap holds the shells
 * and one-rank overflows. The overflow of a frame spanning several ranks is measured with that
 * uniform gap inside the frame and reserved in the one gap it faces only: widening every gap
 * would also lengthen the frame's content, and would space every other rank for one frame.
 */
function frameBoundaryRankGaps(
	context: ShellContext,
	spans: ReadonlyMap<string, RankSpan>,
): FrameRankGaps {
	const base = rankShells(context, spans);
	const shells = { spans, base, gap: context.minimumGap, spanning: false };
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

interface RailPosition {
	readonly interval: number;
	readonly depth: number;
}

function compareRails(left: RailPosition, right: RailPosition): number {
	return left.interval - right.interval || left.depth - right.depth;
}

interface RailSpan {
	readonly first: RailPosition;
	readonly last: RailPosition;
}

function widenRails(span: RailSpan | undefined, own: RailSpan): RailSpan {
	if (span === undefined) return own;
	let { first, last } = span;
	if (compareRails(own.first, first) < 0) first = own.first;
	if (compareRails(own.last, last) > 0) last = own.last;
	return { first, last };
}

/** First and last junction rail of each group holding junctions, nested groups included. */
function groupRailSpans(structure: LayoutStructure): ReadonlyMap<string, RailSpan> {
	const spans = new Map<string, RailSpan>();
	for (const group of structure.hierarchy?.deepestFirst ?? []) {
		let span: RailSpan | undefined;
		for (const member of structure.hierarchy?.membersById.get(group.id) ?? []) {
			const rail = structure.junctions.get(member);
			let own = spans.get(member);
			if (rail !== undefined) own = { first: rail, last: rail };
			if (own !== undefined) span = widenRails(span, own);
		}
		if (span !== undefined) spans.set(group.id, span);
	}
	return spans;
}

/** Shells of the enclosing frames beginning or ending on a junction's rail, inside its gap. */
function junctionShells(
	context: ShellContext,
	spans: {
		readonly ranks: ReadonlyMap<string, RankSpan>;
		readonly rails: ReadonlyMap<string, RailSpan>;
	},
	input: { readonly id: string; readonly rail: RailPosition },
): Shells {
	const { structure, frame, groups } = context;
	const { rail } = input;
	let next = 0;
	let previous = 0;
	let ending = true;
	let starting = true;
	let groupId = structure.graph.endpointsById.get(input.id)?.entity.groupId;
	while (groupId !== undefined && (ending || starting)) {
		const own = defined(spans.rails.get(groupId));
		const firstRank = spans.ranks.get(groupId)?.first ?? Number.POSITIVE_INFINITY;
		const lastRank = spans.ranks.get(groupId)?.last ?? Number.NEGATIVE_INFINITY;
		const { padding, headerHeight } = groups(groupId);
		const header = headerShells(frame, headerHeight);
		// Rank r lies before interval r's rails, rank r + 1 after them.
		const startsHere = compareRails(own.first, rail) === 0 && firstRank > rail.interval;
		const endsHere = compareRails(own.last, rail) === 0 && lastRank <= rail.interval;
		starting &&= startsHere;
		ending &&= endsHere;
		if (starting) previous += padding + header.previous;
		if (ending) next += padding + header.next;
		groupId = structure.hierarchy?.byId.get(groupId)?.groupId;
	}
	return { next, previous };
}

/**
 * A frame whose first or last member is a junction begins or ends on its rail. The channel
 * slot before or after that rail holds the frame's shell, the shell of any frame facing it
 * from the neighbouring rank, and their clearance, whatever the channel already reserves.
 */
function junctionShellGaps(
	context: ShellContext,
	ranks: ReadonlyMap<string, RankSpan>,
): ReadonlyMap<number, readonly number[]> {
	const { structure } = context;
	const result = new Map<number, number[]>();
	if (structure.junctions.size === 0) return result;
	const spans = { ranks, rails: groupRailSpans(structure) };
	// Rank r faces the first rail of interval r, rank r + 1 faces its last rail.
	const facing = rankShells(context, ranks, spans.rails);
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
	const spans = groupRankSpans(context.structure);
	return {
		...frameBoundaryRankGaps(context, spans),
		junctionGaps: junctionShellGaps(context, spans),
	};
}
