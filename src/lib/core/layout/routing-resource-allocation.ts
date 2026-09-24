import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';

/** An edge owns a bounded number of parallel tracks inside its region. */
export interface RoutingEdge {
	readonly ownerId: string;
	/** Number of tracks the edge owns. */
	readonly capacity: number;
	/** Clearance between two adjacent tracks. */
	readonly spacing: number;
}

/** The interval a route occupies along its edge, in the owner's coordinates. */
export interface RoutingTrackDemand {
	readonly relationId: string;
	readonly start: number;
	readonly end: number;
}

export interface RoutingTrackAllocation {
	readonly edge: RoutingEdge;
	readonly trackByRelationId: ReadonlyMap<string, number>;
}

interface TrackInterval {
	readonly relationId: string;
	readonly minimum: number;
	readonly maximum: number;
}

/** The space the edge owns inside its region. */
export function edgeExtent(edge: RoutingEdge): number {
	return edge.capacity * edge.spacing;
}

/** Distance from the edge anchor to a track; track 0 is nearest the edge's children. */
export function trackOffset(edge: RoutingEdge, track: number): number {
	return edge.spacing * (track + 1);
}

/** The declared containment rule of the allocation: an interval must be strictly inside. */
function strictlyContains(outer: TrackInterval, inner: TrackInterval): boolean {
	return outer.minimum < inner.minimum && inner.maximum < outer.maximum;
}

/**
 * Allocates one track per demand: innermost interval first (strict containment),
 * canonical relation-id tie-break, track 0 nearest the children.
 */
export function allocateNestedTracks(
	edge: RoutingEdge,
	demands: readonly RoutingTrackDemand[],
): RoutingTrackAllocation {
	if (demands.length > edge.capacity)
		throw new Error(
			`Routing edge ${edge.ownerId} owns ${edge.capacity} tracks for ${demands.length} demands.`,
		);
	const intervals = demands.map(({ relationId, start, end }) => ({
		relationId,
		minimum: Math.min(start, end),
		maximum: Math.max(start, end),
	}));
	const canonicalIndices = intervals
		.map((_, index) => index)
		.sort((left, right) =>
			compareCanonicalStrings(
				defined(intervals[left]).relationId,
				defined(intervals[right]).relationId,
			),
		);
	const pendingInnerCount = intervals.map((outer) =>
		intervals.reduce((count, inner) => count + Number(strictlyContains(outer, inner)), 0),
	);
	const trackIndices = Array<number>(intervals.length).fill(-1);
	for (let track = 0; track < intervals.length; track += 1) {
		const ready = defined(
			canonicalIndices.find((index) => {
				const unassigned = trackIndices[index] === -1;
				return unassigned && pendingInnerCount[index] === 0;
			}),
			'Portal interval containment must be acyclic.',
		);
		trackIndices[ready] = track;
		for (const [index, outer] of intervals.entries()) {
			if (strictlyContains(outer, defined(intervals[ready])))
				pendingInnerCount[index] = defined(pendingInnerCount[index]) - 1;
		}
	}
	return {
		edge,
		trackByRelationId: new Map(
			intervals.map((interval, index) => [interval.relationId, defined(trackIndices[index])]),
		),
	};
}
