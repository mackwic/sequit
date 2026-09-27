import { compareCanonicalStrings } from '../../canonical-string';
import type { CrossingAllocationInput } from './grid-cell-crossing-allocation-types';
import { trackOrders } from './grid-cell-crossing-orders';

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
