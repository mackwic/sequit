import type { LayoutStructure } from '../structure/prepare-layout';

export interface RailPosition {
	readonly interval: number;
	readonly depth: number;
}

export function compareRails(left: RailPosition, right: RailPosition): number {
	return left.interval - right.interval || left.depth - right.depth;
}

export interface RailSpan {
	readonly first: RailPosition;
	readonly last: RailPosition;
}

export interface RankSpan {
	readonly first: number;
	readonly last: number;
}

/** Ranks and junction rails covered by each group, nested groups included. */
export interface GroupSpans {
	readonly ranks: ReadonlyMap<string, RankSpan>;
	readonly rails: ReadonlyMap<string, RailSpan>;
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

/** Ranks a group member covers: a junction or a group holding only rails covers none. */
function memberRanks(
	structure: LayoutStructure,
	spans: GroupSpans,
	member: string,
): RankSpan | undefined {
	if (structure.junctionIds.has(member)) return undefined;
	const span = spans.ranks.get(member);
	if (span !== undefined || spans.rails.has(member)) return span;
	const rank = structure.ranks.byEndpointId.get(member);
	if (rank === undefined) return undefined;
	return { first: rank, last: rank };
}

/**
 * Ranks and rails covered by each populated group, from its ranked members, junctions and
 * nested groups. A group holding a junction is drawn as its members' frame, never as a box of
 * its own rank.
 */
export function groupSpans(structure: LayoutStructure): GroupSpans {
	const ranks = new Map<string, RankSpan>();
	const spans = { ranks, rails: groupRailSpans(structure) };
	for (const group of structure.hierarchy?.deepestFirst ?? []) {
		let first = Number.POSITIVE_INFINITY;
		let last = Number.NEGATIVE_INFINITY;
		for (const member of structure.hierarchy?.membersById.get(group.id) ?? []) {
			const span = memberRanks(structure, spans, member);
			if (span === undefined) continue;
			first = Math.min(first, span.first);
			last = Math.max(last, span.last);
		}
		if (first <= last) ranks.set(group.id, { first, last });
	}
	return spans;
}
