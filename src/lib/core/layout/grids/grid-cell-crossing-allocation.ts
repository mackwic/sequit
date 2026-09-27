import { defined } from '../../document/logic-document';
import { allocateNestedTracks, type RoutingEdge } from '../resources/routing-resource-allocation';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';
import { crossingBusOrderCandidates } from './grid-cell-crossing-bus-orders';
import { geometryKeyFromAllocation, geometryKeyFromOrders } from './grid-cell-crossing-identity';
import {
	FREE_TRACK,
	portOrders,
	trackOrderFromMap,
	trackOrders,
} from './grid-cell-crossing-orders';
import { withRowRouteChoices } from './grid-cell-crossing-row-choices';

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
	rowOrders: readonly (readonly string[])[] = [],
): GridCrossingAllocation {
	return {
		gutterTrackByRelationId: gutterOrders.map(trackMap),
		busTrackByRelationId: trackMap(busOrder),
		rowTrackByRelationId: rowOrders.map(trackMap),
		portTrackByEndpointId: new Map(
			[...portOrderByEndpointId].map(([endpointId, order]) => [endpointId, trackMap(order)]),
		),
	};
}

function canonicalRowOrders(input: CrossingAllocationInput): readonly (readonly string[])[] {
	return (input.rowGutterIds ?? []).map((ids) =>
		input.crossingIds.filter((id) => ids.includes(id)),
	);
}

/** Canonical bus order restricted to each gutter; canonical port order on each face. */
export function canonicalCrossingAllocation(
	input: CrossingAllocationInput,
): GridCrossingAllocation {
	const restricted = (ids: readonly string[]): readonly string[] =>
		input.crossingIds.filter((relationId) => ids.includes(relationId));
	return allocationOf(
		input.gutterIds.map(restricted),
		input.crossingIds,
		input.incidence,
		canonicalRowOrders(input),
	);
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
		(input.rowGutterIds ?? []).map((ids, row) => {
			if (ids.length === 0) return [];
			return containmentOrder(input, defined(input.edges.rowGutters[row]), ids);
		}),
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
		...(input.rowGutterIds ?? []).map((ids, row) => (): Generator<readonly string[]> => {
			let capacity = 0;
			if (ids.length > 0) capacity = defined(input.edges.rowGutters[row]).capacity;
			return trackOrders(ids, capacity, active, ids);
		}),
	];
	const seen = new Set(excluded);
	const constraints = { input, extraColumn };
	for (const orders of combineOrders(factories, 0, [], constraints)) {
		const busOrder = defined(orders[0]);
		const gutterOrders = orders.slice(1, input.gutterIds.length + 1);
		const rowOrders = orders.slice(input.gutterIds.length + 1);
		for (const portOrderByEndpointId of portOrders(input.incidence, active)) {
			const key = geometryKeyFromOrders(gutterOrders, busOrder, portOrderByEndpointId, {
				busRelevant: busRelevantRelationIds,
				rowTracks: rowOrders,
			});
			if (seen.has(key)) continue;
			seen.add(key);
			yield allocationOf(gutterOrders, busOrder, portOrderByEndpointId, rowOrders);
		}
	}
}

function unchangedTracks(
	canonical: readonly ReadonlyMap<string, number>[],
	candidate: readonly ReadonlyMap<string, number>[],
	active: ReadonlySet<string>,
): boolean {
	for (const [index, tracks] of candidate.entries())
		for (const [id, track] of tracks)
			if (!active.has(id) && defined(canonical[index]).get(id) !== track) return false;
	return true;
}

function containmentMovesOnlyConflicts(
	canonical: GridCrossingAllocation,
	containment: GridCrossingAllocation,
	active: ReadonlySet<string>,
): boolean {
	if (
		!unchangedTracks(canonical.gutterTrackByRelationId, containment.gutterTrackByRelationId, active)
	)
		return false;
	if (
		!unchangedTracks(
			canonical.rowTrackByRelationId ?? [],
			containment.rowTrackByRelationId ?? [],
			active,
		)
	)
		return false;
	for (const [id, track] of containment.busTrackByRelationId)
		if (!active.has(id) && canonical.busTrackByRelationId.get(id) !== track) return false;
	return true;
}

function* prioritizedBusCandidates(
	input: CrossingAllocationInput,
	excluded: Set<string>,
	active?: ReadonlySet<string>,
): Generator<GridCrossingAllocation> {
	const gutterOrders = input.gutterIds.map((ids) =>
		input.crossingIds.filter((id) => ids.includes(id)),
	);
	const rowOrders = canonicalRowOrders(input);
	const busRelevant = new Set(input.busRelevantRelationIds);
	for (const busOrder of crossingBusOrderCandidates(input, active)) {
		const key = geometryKeyFromOrders(gutterOrders, busOrder, input.incidence, {
			busRelevant,
			rowTracks: rowOrders,
		});
		if (excluded.has(key)) continue;
		excluded.add(key);
		yield allocationOf(gutterOrders, busOrder, input.incidence, rowOrders);
	}
}

/** Canonical, containment, then lazy lexicographic bus/gutter/port permutations. */
function* baseCrossingAllocationCandidates(
	input: CrossingAllocationInput,
	active?: ReadonlySet<string>,
	prioritizeBus = false,
): Generator<GridCrossingAllocation, undefined, undefined> {
	const busRelevantRelationIds = new Set(input.busRelevantRelationIds);
	const canonical = canonicalCrossingAllocation(input);
	const excluded = new Set([geometryKeyFromAllocation(canonical, busRelevantRelationIds)]);
	yield canonical;
	const containment = containmentCrossingAllocation(input);
	const containmentKey = geometryKeyFromAllocation(containment, busRelevantRelationIds);
	const allowed =
		active === undefined || containmentMovesOnlyConflicts(canonical, containment, active);
	if (!excluded.has(containmentKey) && allowed) {
		excluded.add(containmentKey);
		yield containment;
	}
	// Bus permutations are cheap with canonical gutters and ports; keep them before the
	// Cartesian gutter product if a conflict requests a bus-first prefix.
	if (prioritizeBus) yield* prioritizedBusCandidates(input, excluded, active);
	yield* permutationCandidates(input, undefined, excluded, active);
}

/** Add one reserved crossing track to one loaded gutter at a time. */
function* baseCrossingAllocationCandidatesWithExtraTrack(
	input: CrossingAllocationInput,
	active?: ReadonlySet<string>,
): Generator<GridCrossingAllocation, undefined, undefined> {
	for (const [column, ids] of input.gutterIds.entries())
		if (ids.length > 0 && input.blockedExtraGutterColumns?.has(column) !== true)
			yield* permutationCandidates(input, column, new Set(), active);
}

/** Canonical and containment allocations, then row/upper-bus choices in the same phase budget. */
export function* crossingAllocationCandidates(
	input: CrossingAllocationInput,
	active?: ReadonlySet<string>,
	prioritizeBus = false,
): Generator<GridCrossingAllocation, undefined, undefined> {
	let rowFrontier: ReadonlySet<string> | undefined;
	if (prioritizeBus) rowFrontier = active;
	yield* withRowRouteChoices(
		input,
		baseCrossingAllocationCandidates(input, active, prioritizeBus),
		rowFrontier,
	);
}

/** One extra column track, with the same row/upper-bus alternatives. */
export function* crossingAllocationCandidatesWithExtraTrack(
	input: CrossingAllocationInput,
	active?: ReadonlySet<string>,
): Generator<GridCrossingAllocation, undefined, undefined> {
	yield* withRowRouteChoices(
		input,
		baseCrossingAllocationCandidatesWithExtraTrack(input, active),
		active,
	);
}
