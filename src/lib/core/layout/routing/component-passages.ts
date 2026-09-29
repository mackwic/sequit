import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, RoutingLayers } from '../layout-types';

interface ComponentEnvelope {
	readonly start: number;
	readonly end: number;
	readonly mainStart: number;
	readonly mainEnd: number;
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

function componentIntervals(input: ComponentPassageInput): ReadonlyMap<number, ComponentEnvelope> {
	const intervals = new Map<number, ComponentEnvelope>();
	const owners = defined(input.componentByEndpointId);
	for (const [id, box] of input.bounds) {
		const owner = owners.get(id);
		if (owner === undefined) continue;
		let start = box.y;
		let end = box.y + box.height;
		let mainStart = box.x;
		let mainEnd = box.x + box.width;
		if (input.vertical) {
			start = box.x;
			end = box.x + box.width;
			mainStart = box.y;
			mainEnd = box.y + box.height;
		}
		const previous = intervals.get(owner);
		intervals.set(owner, {
			start: Math.min(previous?.start ?? start, start),
			end: Math.max(previous?.end ?? end, end),
			mainStart: Math.min(previous?.mainStart ?? mainStart, mainStart),
			mainEnd: Math.max(previous?.mainEnd ?? mainEnd, mainEnd),
		});
	}
	return intervals;
}

interface SideClearances {
	readonly leadingClearance: number;
	readonly trailingClearance: number;
	readonly hasLeadingNeighbor: boolean;
	readonly hasTrailingNeighbor: boolean;
}

function neighborClearances(
	owner: number,
	interval: ComponentEnvelope,
	intervals: ReadonlyMap<number, ComponentEnvelope>,
	leadingHasCandidate: boolean,
): SideClearances {
	let leadingClearance = 0;
	if (leadingHasCandidate) leadingClearance = Infinity;
	let trailingClearance = Infinity;
	let hasLeadingNeighbor = false;
	let hasTrailingNeighbor = false;
	for (const [otherOwner, other] of intervals) {
		if (owner === otherOwner) continue;
		if (other.mainEnd <= interval.mainStart || interval.mainEnd <= other.mainStart) continue;
		if (other.end <= interval.start) {
			hasLeadingNeighbor = true;
			leadingClearance = Math.min(leadingClearance, interval.start - other.end);
			continue;
		}
		if (other.start >= interval.end) {
			hasTrailingNeighbor = true;
			trailingClearance = Math.min(trailingClearance, other.start - interval.end);
			continue;
		}
		if (other.start < interval.start) {
			hasLeadingNeighbor = true;
			leadingClearance = 0;
		}
		if (other.end > interval.end) {
			hasTrailingNeighbor = true;
			trailingClearance = 0;
		}
	}
	return { leadingClearance, trailingClearance, hasLeadingNeighbor, hasTrailingNeighbor };
}

function preferClearerSide(
	leading: readonly number[],
	trailing: readonly number[],
	clearances: SideClearances,
	leadingHasRoom: boolean,
): ExteriorCandidates {
	const { leadingClearance, trailingClearance, hasLeadingNeighbor, hasTrailingNeighbor } =
		clearances;
	const requiredClearance = (trailing.length + 1) * RAIL_SPACING;
	if (hasLeadingNeighbor && trailingClearance > leadingClearance) {
		if (trailingClearance >= requiredClearance) return { preferred: trailing, fallback: leading };
		return { preferred: NO_EXTERIOR.preferred, fallback: [...trailing, ...leading] };
	}
	if (hasTrailingNeighbor && leadingHasRoom && leadingClearance > trailingClearance) {
		if (leadingClearance >= requiredClearance) return { preferred: leading, fallback: trailing };
		return { preferred: NO_EXTERIOR.preferred, fallback: [...leading, ...trailing] };
	}
	return { preferred: NO_EXTERIOR.preferred, fallback: [...leading, ...trailing] };
}

/**
 * Coordinates owned by one component beside its envelope. Without a neighbor either side is a
 * fallback; the passage selection then compares the crossings of their end jogs.
 */
export function componentExteriorCandidates(
	input: ComponentPassageInput,
): ReadonlyMap<number, ExteriorCandidates> {
	const candidates = new Map<number, ExteriorCandidates>();
	const counts = longRelationCounts(input);
	if (counts.size === 0) return candidates;
	const intervals = componentIntervals(input);
	for (const [owner, count] of counts) {
		const interval = defined(intervals.get(owner));
		const leading = Array.from(
			{ length: count },
			(_, index) => interval.start - (index + 1) * RAIL_SPACING,
		).filter((coordinate) => coordinate >= 0);
		const trailing = Array.from(
			{ length: count },
			(_, index) => interval.end + (index + 1) * RAIL_SPACING,
		);
		// Prefer leading tracks only if all fit a rail away from the canvas edge.
		const lastLeading = leading.at(-1);
		const fitsAll = leading.length === count;
		let leadingHasRoom = false;
		if (lastLeading !== undefined && fitsAll) leadingHasRoom = lastLeading >= RAIL_SPACING;
		// Neighbors constrain a side only when their primary bands overlap.
		// The preferred side must fit every concurrent rail plus a rail of neighbor clearance.
		const clearances = neighborClearances(owner, interval, intervals, leading.length > 0);
		candidates.set(owner, preferClearerSide(leading, trailing, clearances, leadingHasRoom));
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
