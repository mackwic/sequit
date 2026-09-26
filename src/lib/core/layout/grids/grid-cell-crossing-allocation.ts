import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { Point } from '../layout-types';
import { allocateNestedTracks, type RoutingEdge } from '../resources/routing-resource-allocation';
import type { GridRoutingEdges } from './grid-cell-crossing';
import { geometryKeyFromAllocation, geometryKeyFromOrders } from './grid-cell-crossing-identity';
import {
	FREE_TRACK,
	portOrders,
	trackOrderFromMap,
	trackOrders,
} from './grid-cell-crossing-orders';

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
	/** An inherited incident already uses the outer track of these gutters. */
	readonly blockedExtraGutterColumns?: ReadonlySet<number> | undefined;
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

/** Canonical bus order restricted to each gutter; canonical port order on each face. */
export function canonicalCrossingAllocation(
	input: CrossingAllocationInput,
): GridCrossingAllocation {
	const restricted = (ids: readonly string[]): readonly string[] =>
		input.crossingIds.filter((relationId) => ids.includes(relationId));
	return allocationOf(input.gutterIds.map(restricted), input.crossingIds, input.incidence);
}

/**
 * One order from the interval containment rule: the innermost interval takes track 0. The order
 * keeps exactly one slot per relation using this gutter.
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
	const order = Array<string>(ids.length).fill(FREE_TRACK);
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

function* combineOrders(
	factories: readonly TrackOrderFactory[],
	index: number,
	prefix: (readonly string[])[],
	constraints: {
		readonly input: CrossingAllocationInput;
		readonly extraColumn: number | undefined;
	},
): Generator<readonly (readonly string[])[]> {
	const factory = factories[index];
	if (factory !== undefined) {
		for (const order of factory()) {
			prefix.push(order);
			yield* combineOrders(factories, index + 1, prefix, constraints);
			prefix.pop();
		}
		return;
	}
	if (constraints.extraColumn === undefined) {
		yield [...prefix];
		return;
	}
	const column = constraints.extraColumn;
	const order = defined(prefix[column + 1]);
	const reservedTrack = defined(constraints.input.edges.gutters[column]).capacity - 1;
	if (order[reservedTrack] !== FREE_TRACK) yield [...prefix];
}

/** Lexicographic first representative of each effective bus geometry: irrelevant routes retain
 * their relative canonical order rather than multiplying the same geometry factorially. */
function* distinctBusOrders(
	relevant: readonly string[],
	context: { readonly inert: readonly string[]; readonly capacity: number },
	inertIndex: number,
	prefix: string[],
): Generator<readonly string[], undefined, undefined> {
	if (prefix.length === context.capacity) {
		yield [...prefix];
		return;
	}
	const nextInert = context.inert[inertIndex];
	let choices = relevant;
	if (nextInert !== undefined) choices = [...relevant, nextInert].sort(compareCanonicalStrings);
	for (const id of choices) {
		prefix.push(id);
		if (id === nextInert) yield* distinctBusOrders(relevant, context, inertIndex + 1, prefix);
		else
			yield* distinctBusOrders(
				relevant.filter((candidate) => candidate !== id),
				context,
				inertIndex,
				prefix,
			);
		prefix.pop();
	}
}

/** Exactly one constructed bus proposal per effective assignment, canonical first. A priority
 * frontier freezes inert and nonconflicting relations; the complete suffix permits relevant
 * relations to occupy any bus slot while fixing inert routes in canonical relative order. */
export function* crossingBusOrderCandidates(
	input: CrossingAllocationInput,
	active?: ReadonlySet<string>,
): Generator<readonly string[], undefined, undefined> {
	const canonical = input.crossingIds;
	yield canonical;
	const relevant = new Set(input.busRelevantRelationIds);
	let orders: Iterable<readonly string[]>;
	if (active === undefined)
		orders = distinctBusOrders(
			input.busRelevantRelationIds,
			{
				inert: input.crossingIds.filter((id) => !relevant.has(id)),
				capacity: input.edges.topBus.capacity,
			},
			0,
			[],
		);
	else
		orders = trackOrders(
			input.busRelevantRelationIds,
			input.edges.topBus.capacity,
			new Set(input.busRelevantRelationIds.filter((id) => active.has(id))),
			canonical,
		);
	for (const order of orders) if (order.some((id, index) => id !== canonical[index])) yield order;
}

function* permutationCandidates(
	input: CrossingAllocationInput,
	extraColumn: number | undefined,
	excluded: Set<string>,
	active?: ReadonlySet<string>,
): Generator<GridCrossingAllocation, undefined, undefined> {
	const busRelevantRelationIds = new Set(input.busRelevantRelationIds);
	const canonical = canonicalCrossingAllocation(input);
	const factories: TrackOrderFactory[] = [
		() => crossingBusOrderCandidates(input, active),
		...input.gutterIds.map((ids, column) => (): Generator<readonly string[]> => {
			const capacity = defined(input.edges.gutters[column]).capacity - 1;
			return trackOrders(
				ids,
				capacity + Number(column === extraColumn),
				active,
				trackOrderFromMap(ids, defined(canonical.gutterTrackByRelationId[column]), capacity),
			);
		}),
	];
	const seen = new Set(excluded);
	const constraints = { input, extraColumn };
	for (const orders of combineOrders(factories, 0, [], constraints)) {
		const busOrder = defined(orders[0]);
		const gutterOrders = orders.slice(1);
		for (const portOrderByEndpointId of portOrders(input.incidence, active)) {
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
}

function containmentMovesOnlyConflicts(
	canonical: GridCrossingAllocation,
	containment: GridCrossingAllocation,
	active: ReadonlySet<string>,
): boolean {
	for (const [column, tracks] of containment.gutterTrackByRelationId.entries()) {
		for (const [id, track] of tracks)
			if (!active.has(id) && defined(canonical.gutterTrackByRelationId[column]).get(id) !== track)
				return false;
	}
	for (const [id, track] of containment.busTrackByRelationId)
		if (!active.has(id) && canonical.busTrackByRelationId.get(id) !== track) return false;
	return true;
}

/** Canonical, containment, then lazy lexicographic bus/gutter/port permutations. */
export function* crossingAllocationCandidates(
	input: CrossingAllocationInput,
	active?: ReadonlySet<string>,
	prioritizeBus = false,
): Generator<GridCrossingAllocation, undefined, undefined> {
	const busRelevantRelationIds = new Set(input.busRelevantRelationIds);
	const canonical = canonicalCrossingAllocation(input);
	const excluded = new Set([
		geometryKeyFromAllocation(
			canonical.gutterTrackByRelationId,
			canonical.busTrackByRelationId,
			canonical.portTrackByEndpointId,
			busRelevantRelationIds,
		),
	]);
	yield canonical;
	const containment = containmentCrossingAllocation(input);
	const containmentKey = geometryKeyFromAllocation(
		containment.gutterTrackByRelationId,
		containment.busTrackByRelationId,
		containment.portTrackByEndpointId,
		busRelevantRelationIds,
	);
	const allowed =
		active === undefined || containmentMovesOnlyConflicts(canonical, containment, active);
	if (!excluded.has(containmentKey) && allowed) {
		excluded.add(containmentKey);
		yield containment;
	}
	// Bus permutations are cheap to try with the canonical gutters and ports. Without this
	// prefix, the Cartesian product of gutters hides a valid bus order beyond the budget.
	if (prioritizeBus) {
		const gutterOrders = input.gutterIds.map((ids) =>
			input.crossingIds.filter((id) => ids.includes(id)),
		);
		for (const busOrder of crossingBusOrderCandidates(input, active)) {
			const key = geometryKeyFromOrders(
				gutterOrders,
				busOrder,
				input.incidence,
				busRelevantRelationIds,
			);
			if (excluded.has(key)) continue;
			excluded.add(key);
			yield allocationOf(gutterOrders, busOrder, input.incidence);
		}
	}
	yield* permutationCandidates(input, undefined, excluded, active);
}

/** Add one reserved crossing track to one loaded gutter at a time. */
export function* crossingAllocationCandidatesWithExtraTrack(
	input: CrossingAllocationInput,
	active?: ReadonlySet<string>,
): Generator<GridCrossingAllocation, undefined, undefined> {
	for (const [column, ids] of input.gutterIds.entries())
		if (ids.length > 0 && input.blockedExtraGutterColumns?.has(column) !== true)
			yield* permutationCandidates(input, column, new Set(), active);
}
