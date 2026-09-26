import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, RoutingLayers } from '../layout-types';

interface Interval {
	readonly start: number;
	readonly end: number;
}

export interface ExteriorCandidates {
	readonly preferred: readonly number[];
	readonly fallback: readonly number[];
}

const NO_EXTERIOR: ExteriorCandidates = { preferred: [], fallback: [] };

interface ComponentPassageInput {
	readonly graph: LogicGraph;
	readonly layers: RoutingLayers;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly componentByEndpointId?: ReadonlyMap<string, number> | undefined;
}

function longRelationCounts(input: ComponentPassageInput): ReadonlyMap<number, number> {
	const counts = new Map<number, number>();
	const owners = input.componentByEndpointId;
	if (owners === undefined) return counts;
	for (const { relation, source, target } of input.graph.relations) {
		if (source.kind !== EndpointKind.Node || target.kind !== EndpointKind.Node) continue;
		const from = defined(input.layers.byId.get(relation.from));
		const to = defined(input.layers.byId.get(relation.to));
		if (from <= to + 1) continue;
		const owner = defined(owners.get(relation.from));
		counts.set(owner, (counts.get(owner) ?? 0) + 1);
	}
	return counts;
}

function componentIntervals(input: ComponentPassageInput): ReadonlyMap<number, Interval> {
	const intervals = new Map<number, Interval>();
	const owners = defined(input.componentByEndpointId);
	for (const [id, box] of input.bounds) {
		const owner = owners.get(id);
		if (owner === undefined) continue;
		let start = box.y;
		let end = box.y + box.height;
		if (input.vertical) {
			start = box.x;
			end = box.x + box.width;
		}
		const previous = intervals.get(owner);
		intervals.set(owner, {
			start: Math.min(previous?.start ?? start, start),
			end: Math.max(previous?.end ?? end, end),
		});
	}
	return intervals;
}

/** Coordinates owned by one component, never the outermost coordinate of the whole canvas. */
export function componentExteriorCandidates(
	input: ComponentPassageInput,
): ReadonlyMap<number, ExteriorCandidates> {
	const candidates = new Map<number, ExteriorCandidates>();
	const counts = longRelationCounts(input);
	if (counts.size === 0) return candidates;
	const intervals = componentIntervals(input);
	if (intervals.size < 2) return candidates;
	let first = Infinity;
	let last = -Infinity;
	for (const interval of intervals.values()) {
		first = Math.min(first, interval.start);
		last = Math.max(last, interval.end);
	}
	for (const [owner, count] of counts) {
		const interval = defined(intervals.get(owner));
		const leading = Array.from(
			{ length: count },
			(_, index) => interval.start - (index + 1) * RAIL_SPACING,
		);
		const trailing = Array.from(
			{ length: count },
			(_, index) => interval.end + (index + 1) * RAIL_SPACING,
		);
		let preferred: readonly number[] = [];
		let fallback: readonly number[] = [...leading, ...trailing];
		if (interval.end === last && interval.start > first) {
			preferred = trailing;
			fallback = leading;
		}
		candidates.set(owner, { preferred, fallback });
	}
	return candidates;
}

export function exteriorFor(
	id: string,
	owners: ReadonlyMap<string, number> | undefined,
	candidates: ReadonlyMap<number, ExteriorCandidates>,
): ExteriorCandidates {
	const owner = owners?.get(id);
	if (owner === undefined) return NO_EXTERIOR;
	return candidates.get(owner) ?? NO_EXTERIOR;
}
