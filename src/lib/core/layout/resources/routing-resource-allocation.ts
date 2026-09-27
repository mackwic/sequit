import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { RoutingEdge } from '../geometry/routing-edge';

/** The interval a route occupies along its edge, in the owner's coordinates. */
export interface RoutingTrackDemand {
	/** Identity of the allocated occurrence, not the relation(s) carried by it. */
	readonly key: string;
	/** Optional source provenance; one run can carry several relations. */
	readonly relationIds?: readonly string[];
	readonly start: number;
	readonly end: number;
	/**
	 * Declared rank of the demand among the demands of its edge; absent, the canonical allocation-key
	 * order decides, which is the order every edge used before an ordinal existed.
	 */
	readonly order?: number;
}

export interface RoutingTrackAllocation {
	readonly edge: RoutingEdge;
	readonly trackByKey: ReadonlyMap<string, number>;
}

/** The single track of an edge whose space is a free interval rather than a spacing grid. */
export interface CenteredTrackAllocation {
	readonly edge: RoutingEdge;
	readonly demand: RoutingTrackDemand;
	readonly track: number;
}

interface TrackInterval {
	readonly key: string;
	readonly order: number | undefined;
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
 * The order of two demands of the same edge: a declared ordinal first, then the canonical allocation
 * key. A demand that declares no ordinal sorts after the declared ones, so an edge whose
 * demands all omit it keeps the pure canonical key order.
 */
function compareTrackDemands(left: TrackInterval, right: TrackInterval): number {
	const declaredLeft = left.order;
	const declaredRight = right.order;
	if (declaredLeft === undefined && declaredRight === undefined) return canonicalOrder(left, right);
	if (declaredLeft === undefined) return 1;
	if (declaredRight === undefined) return -1;
	if (declaredLeft !== declaredRight) return declaredLeft - declaredRight;
	return canonicalOrder(left, right);
}

/** The canonical tie-break of two demands that declare the same ordinal, or none. */
function canonicalOrder(left: TrackInterval, right: TrackInterval): number {
	return compareCanonicalStrings(left.key, right.key);
}

/**
 * Allocates one track per demand: innermost interval first (strict containment),
 * declared ordinal then canonical allocation-key tie-break, track 0 nearest the children.
 */
export function allocateNestedTracks(
	edge: RoutingEdge,
	demands: readonly RoutingTrackDemand[],
): RoutingTrackAllocation {
	if (demands.length > edge.capacity)
		throw new Error(
			`Routing edge ${edge.ownerId} owns ${edge.capacity} tracks for ${demands.length} demands.`,
		);
	const intervals = demands.map(({ key, order, start, end }) => ({
		key,
		order,
		minimum: Math.min(start, end),
		maximum: Math.max(start, end),
	}));
	const canonicalIndices = intervals
		.map((_, index) => index)
		.sort((left, right) =>
			compareTrackDemands(defined(intervals[left]), defined(intervals[right])),
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
		trackByKey: new Map(
			intervals.map((interval, index) => [interval.key, defined(trackIndices[index])]),
		),
	};
}

/**
 * Allocates the single track of an edge whose space is a free interval: track 0 sits in the middle
 * of that interval. Such an edge reserves no `edgeExtent` — its space is the empty rank its owner
 * already holds — so its track is deliberately off the spacing grid `trackOffset` describes.
 */
export function allocateCenteredTrack(
	edge: RoutingEdge,
	demand: RoutingTrackDemand,
): CenteredTrackAllocation {
	return { edge, demand, track: 0 };
}

/** The coordinate of a centred track, in its owner's coordinates. */
export function centeredTrackOffset(allocation: CenteredTrackAllocation): number {
	return (allocation.demand.start + allocation.demand.end) / 2;
}
