import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import type { GridRoutingEdges } from './grid-cell-crossing';
import type { Point } from './layout-types';
import { allocateNestedTracks, type RoutingEdge } from './routing-resource-allocation';

/** A gutter track that no crossing relation uses: the edge owns one more track than it carries. */
const FREE_TRACK = '';

/** One allocated track per crossing relation, on each gutter edge and on the bus. */
export interface GridCrossingAllocation {
	/** One track map per column gutter, in column order. */
	readonly gutterTrackByRelationId: readonly ReadonlyMap<string, number>[];
	readonly busTrackByRelationId: ReadonlyMap<string, number>;
	readonly portTrackByEndpointId: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** The two portal points a crossing relation leaves from, in canonical port order. */
export interface CrossingPortalSpan {
	readonly source: Point;
	readonly target: Point;
}

export interface CrossingAllocationInput {
	readonly edges: GridRoutingEdges;
	/** Crossing relation identities in canonical order. */
	readonly crossingIds: readonly string[];
	/** Relations whose endpoints use different rails and therefore use a bus track geometrically. */
	readonly busRelevantRelationIds: readonly string[];
	/** Crossing relations with an endpoint in each column, in canonical order, per column. */
	readonly gutterIds: readonly (readonly string[])[];
	/** Canonical port order per endpoint. */
	readonly incidence: ReadonlyMap<string, readonly string[]>;
	readonly portalByRelationId: ReadonlyMap<string, CrossingPortalSpan>;
}

type TrackOrderFactory = () => Generator<readonly string[]>;

function trackMap(order: readonly string[]): ReadonlyMap<string, number> {
	const tracks = new Map<string, number>();
	for (const [track, relationId] of order.entries())
		if (relationId !== FREE_TRACK) tracks.set(relationId, track);
	return tracks;
}

function allocationOf(
	gutterOrders: readonly (readonly string[])[],
	busOrder: readonly string[],
	portOrderByEndpointId: ReadonlyMap<string, readonly string[]>,
): GridCrossingAllocation {
	return {
		gutterTrackByRelationId: gutterOrders.map(trackMap),
		busTrackByRelationId: trackMap(busOrder),
		portTrackByEndpointId: new Map(
			[...portOrderByEndpointId].map(([endpointId, order]) => [endpointId, trackMap(order)]),
		),
	};
}

/**
 * The canonical allocation: the crossing order on the bus, the same order restricted to each
 * gutter edge, and the canonical port order on each face.
 */
export function canonicalCrossingAllocation(
	input: CrossingAllocationInput,
): GridCrossingAllocation {
	const restricted = (ids: readonly string[]): readonly string[] =>
		input.crossingIds.map((relationId) => {
			if (ids.includes(relationId)) return relationId;
			return FREE_TRACK;
		});
	return allocationOf(input.gutterIds.map(restricted), input.crossingIds, input.incidence);
}

/**
 * One order from the interval containment rule: the innermost interval takes track 0. The order
 * keeps one slot per crossing track, free when no relation of the edge uses it.
 */
function containmentOrder(
	input: CrossingAllocationInput,
	edge: RoutingEdge,
	ids: readonly string[],
): readonly string[] {
	const allocation = allocateNestedTracks(
		edge,
		ids.map((relationId) => {
			const portal = defined(input.portalByRelationId.get(relationId));
			return { relationId, start: portal.source.y, end: portal.target.y };
		}),
	);
	const order = Array<string>(input.crossingIds.length).fill(FREE_TRACK);
	for (const relationId of ids)
		order[defined(allocation.trackByRelationId.get(relationId))] = relationId;
	return order;
}

/** The containment allocation: gutters by interval inclusion on y, the bus on x, ports canonical. */
export function containmentCrossingAllocation(
	input: CrossingAllocationInput,
): GridCrossingAllocation {
	const bus = allocateNestedTracks(
		input.edges.topBus,
		input.crossingIds.map((relationId) => {
			const portal = defined(input.portalByRelationId.get(relationId));
			return { relationId, start: portal.source.x, end: portal.target.x };
		}),
	);
	const busOrder = Array<string>(input.crossingIds.length).fill(FREE_TRACK);
	for (const relationId of input.crossingIds)
		busOrder[defined(bus.trackByRelationId.get(relationId))] = relationId;
	return allocationOf(
		input.gutterIds.map((ids, column) =>
			containmentOrder(input, defined(input.edges.gutters[column]), ids),
		),
		busOrder,
		input.incidence,
	);
}

function* permutations<T>(values: readonly T[]): Generator<readonly T[]> {
	if (values.length === 0) {
		yield [];
		return;
	}
	const seen = new Set<T>();
	for (const [index, value] of values.entries()) {
		if (seen.has(value)) continue;
		seen.add(value);
		const rest = [...values.slice(0, index), ...values.slice(index + 1)];
		for (const tail of permutations(rest)) yield [value, ...tail];
	}
}

/** Every assignment of the identifiers onto `trackCount` tracks, in lexicographic order. */
function* trackOrders(ids: readonly string[], trackCount: number): Generator<readonly string[]> {
	const slots = [...ids, ...Array<string>(trackCount - ids.length).fill(FREE_TRACK)];
	yield* permutations([...slots].sort(compareCanonicalStrings));
}

function* preferredTrackOrders(
	ids: readonly string[],
	trackCount: number,
): Generator<readonly string[]> {
	yield ids;
	for (const order of trackOrders(ids, trackCount)) {
		if (order.some((id, index) => id !== ids[index])) yield order;
	}
}

function* portOrders(
	incidence: ReadonlyMap<string, readonly string[]>,
): Generator<ReadonlyMap<string, readonly string[]>> {
	const entries = [...incidence].sort(([left], [right]) => compareCanonicalStrings(left, right));
	yield* combinePortOrders(entries, 0, new Map());
}

function* combinePortOrders(
	entries: readonly (readonly [string, readonly string[]])[],
	index: number,
	prefix: Map<string, readonly string[]>,
): Generator<ReadonlyMap<string, readonly string[]>> {
	const entry = entries[index];
	if (entry === undefined) {
		yield new Map(prefix);
		return;
	}
	for (const order of permutations(entry[1])) {
		prefix.set(entry[0], order);
		yield* combinePortOrders(entries, index + 1, prefix);
	}
}

type TrackEntries = readonly (readonly [string, number])[];

/** Geometry identity omits bus tracks that no route reaches because both endpoints share a rail. */
function geometryKeyFromOrders(
	gutterOrders: readonly (readonly string[])[],
	busOrder: readonly string[],
	portOrderByEndpointId: ReadonlyMap<string, readonly string[]>,
	busRelevantRelationIds: ReadonlySet<string>,
): string {
	const entries = (
		order: readonly string[],
		relevantRelationIds?: ReadonlySet<string>,
	): TrackEntries => {
		const result: [string, number][] = [];
		for (const [track, relationId] of order.entries()) {
			if (relationId === FREE_TRACK) continue;
			if (relevantRelationIds !== undefined && !relevantRelationIds.has(relationId)) continue;
			result.push([relationId, track]);
		}
		return result.sort(([left], [right]) => compareCanonicalStrings(left, right));
	};
	return JSON.stringify([
		gutterOrders.map((order) => entries(order)),
		entries(busOrder, busRelevantRelationIds),
		[...portOrderByEndpointId]
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
			.map(([endpointId, order]) => [endpointId, entries(order)]),
	]);
}
function* combineOrders(
	factories: readonly TrackOrderFactory[],
	index: number,
	prefix: (readonly string[])[],
): Generator<readonly (readonly string[])[]> {
	const factory = factories[index];
	if (factory === undefined) {
		yield [...prefix];
		return;
	}
	for (const order of factory()) {
		prefix.push(order);
		yield* combineOrders(factories, index + 1, prefix);
		prefix.pop();
	}
}

function* permutationCandidates(
	input: CrossingAllocationInput,
	extraTracks: number,
	excluded: Set<string>,
	busRelevantRelationIds: ReadonlySet<string>,
): Generator<GridCrossingAllocation, undefined, undefined> {
	const factories: TrackOrderFactory[] = [
		() => preferredTrackOrders(input.crossingIds, input.edges.topBus.capacity),
		...input.gutterIds.map(
			(_ids, column) => (): Generator<readonly string[]> =>
				trackOrders(
					defined(input.gutterIds[column]),
					defined(input.edges.gutters[column]).capacity - 1 + extraTracks,
				),
		),
	];
	const seen = new Set(excluded);
	for (const orders of combineOrders(factories, 0, []))
		for (const portOrderByEndpointId of portOrders(input.incidence)) {
			const busOrder = defined(orders[0]);
			const gutterOrders = orders.slice(1);
			const key = geometryKeyFromOrders(
				gutterOrders,
				busOrder,
				portOrderByEndpointId,
				busRelevantRelationIds,
			);
			if (seen.has(key)) continue;
			seen.add(key);
			yield allocationOf(gutterOrders, busOrder, portOrderByEndpointId);
		}
}

/**
 * The declared allocation candidates: the canonical allocation, the containment allocation, then
 * the remaining bus, gutter, and port permutations in lexicographic order. The list is lazy, so a
 * bounded search never materializes more than the candidates it evaluates.
 */
export function* crossingAllocationCandidates(
	input: CrossingAllocationInput,
): Generator<GridCrossingAllocation, undefined, undefined> {
	const busRelevantRelationIds = new Set(input.busRelevantRelationIds);
	const geometryKeyFromAllocation = (allocation: GridCrossingAllocation): string => {
		const entries = (tracks: ReadonlyMap<string, number>): TrackEntries =>
			[...tracks].sort(([left], [right]) => compareCanonicalStrings(left, right));
		return JSON.stringify([
			allocation.gutterTrackByRelationId.map(entries),
			entries(allocation.busTrackByRelationId).filter(([relationId]) =>
				busRelevantRelationIds.has(relationId),
			),
			[...allocation.portTrackByEndpointId]
				.sort(([left], [right]) => compareCanonicalStrings(left, right))
				.map(([endpointId, tracks]) => [endpointId, entries(tracks)]),
		]);
	};
	const canonical = canonicalCrossingAllocation(input);
	const excluded = new Set([geometryKeyFromAllocation(canonical)]);
	yield canonical;
	const containment = containmentCrossingAllocation(input);
	const containmentKey = geometryKeyFromAllocation(containment);
	if (!excluded.has(containmentKey)) {
		excluded.add(containmentKey);
		yield containment;
	}
	yield* permutationCandidates(input, 0, excluded, busRelevantRelationIds);
}

/** Only allocations using the newly reserved gutter track add a new route geometry. */
export function* crossingAllocationCandidatesWithExtraTrack(
	input: CrossingAllocationInput,
): Generator<GridCrossingAllocation, undefined, undefined> {
	const busRelevantRelationIds = new Set(input.busRelevantRelationIds);
	for (const allocation of permutationCandidates(input, 1, new Set(), busRelevantRelationIds)) {
		const reservesNewTrack = allocation.gutterTrackByRelationId.some((tracks, column) => {
			const reservedTrack = defined(input.edges.gutters[column]).capacity - 1;
			return [...tracks.values()].includes(reservedTrack);
		});
		if (reservesNewTrack) yield allocation;
	}
}
