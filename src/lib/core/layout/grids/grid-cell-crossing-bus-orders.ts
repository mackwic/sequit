import { defined } from '../../document/logic-document';
import type { CrossingAllocationInput } from './grid-cell-crossing-allocation-types';
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
