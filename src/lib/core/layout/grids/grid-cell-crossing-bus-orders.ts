import { defined } from '../../document/logic-document';
import { allocateNestedTracks } from '../resources/routing-resource-allocation';
import type {
	CrossingAllocationInput,
	CrossingPortal,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';
import { trackOrders } from './grid-cell-crossing-orders';

/** Documentary-first representative of each effective bus geometry: irrelevant routes retain
 * their relative documentary order rather than multiplying the same geometry factorially. */
function* distinctBusOrders(
	relevant: readonly string[],
	context: {
		readonly inert: readonly string[];
		readonly capacity: number;
		readonly relationOrder: ReadonlyMap<string, number>;
	},
	inertIndex: number,
	prefix: string[],
): Generator<readonly string[], undefined, undefined> {
	if (prefix.length === context.capacity) {
		yield [...prefix];
		return;
	}
	const nextInert = context.inert[inertIndex];
	let choices = relevant;
	if (nextInert !== undefined)
		choices = [...relevant, nextInert].sort(
			(left, right) =>
				defined(context.relationOrder.get(left)) - defined(context.relationOrder.get(right)),
		);
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

function busOrderCandidates(
	input: CrossingAllocationInput,
	active: ReadonlySet<string> | undefined,
	relevant: ReadonlySet<string>,
	documentary: readonly string[],
): Iterable<readonly string[]> {
	if (active === undefined)
		return distinctBusOrders(
			input.busRelevantRelationIds,
			{
				inert: input.crossingIds.filter((id) => !relevant.has(id)),
				capacity: input.edges.topBus.capacity,
				relationOrder: new Map(input.crossingIds.map((id, index) => [id, index])),
			},
			0,
			[],
		);
	return trackOrders(
		input.busRelevantRelationIds,
		input.edges.topBus.capacity,
		new Set(input.busRelevantRelationIds.filter((id) => active.has(id))),
		documentary,
	);
}

/** Documentary-first bus proposals; inert routes retain documentary relative order. */
export function* crossingBusOrderCandidates(
	input: CrossingAllocationInput,
	active?: ReadonlySet<string>,
): Generator<readonly string[], undefined, undefined> {
	const documentary = input.crossingIds;
	yield documentary;
	const relevant = new Set(input.busRelevantRelationIds);
	const orders = busOrderCandidates(input, active, relevant, documentary);
	for (const order of orders) if (order.some((id, index) => id !== documentary[index])) yield order;
}

/**
 * Couple the upper bus to the allocated column rails. Column gutters are ordered left to right;
 * tracks grow leftwards except on the final gutter. These ordinal coordinates express that
 * ordering without depending on an endpoint's face, its flow direction or its measured position.
 * On the bus, unlike the rails, the highest track is the innermost one.
 */
export function railNestedBusAllocation(
	input: CrossingAllocationInput,
	allocation: GridCrossingAllocation,
	active?: ReadonlySet<string>,
): GridCrossingAllocation {
	const rowRouted = new Set<string>();
	if (allocation.rowTrackByRelationId !== undefined)
		for (const tracks of allocation.rowTrackByRelationId)
			for (const id of tracks.keys()) rowRouted.add(id);
	const ids = input.busRelevantRelationIds.filter((id) => {
		if (rowRouted.has(id)) return false;
		return active === undefined || active.has(id);
	});
	if (ids.length < 2) return allocation;
	const railPosition = (id: string, portal: CrossingPortal): number => {
		const track = defined(defined(allocation.gutterTrackByRelationId[portal.column]).get(id));
		let offset = -track;
		if (portal.column === input.gutterIds.length - 1) offset = track;
		const columnSpacing = input.crossingIds.length + 2;
		return portal.column * columnSpacing + offset;
	};
	const tracks = allocateNestedTracks(
		input.edges.topBus,
		ids.map((id, index) => {
			const portal = defined(input.portalByRelationId.get(id));
			return {
				key: id,
				order: -index,
				start: railPosition(id, portal.source),
				end: railPosition(id, portal.target),
			};
		}),
	);
	const slots = ids
		.map((id) => defined(allocation.busTrackByRelationId.get(id)))
		.sort((left, right) => right - left);
	const busTrackByRelationId = new Map(allocation.busTrackByRelationId);
	for (const id of ids)
		busTrackByRelationId.set(id, defined(slots[defined(tracks.trackByKey.get(id))]));
	return { ...allocation, busTrackByRelationId };
}
