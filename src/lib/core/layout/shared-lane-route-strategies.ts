/** One declared lane routing attempt: the order it routes, and whether its pass accepts bridges. */
export interface LaneRouteStrategy<Order> {
	readonly id: string;
	readonly acceptBridges: boolean;
	readonly order: Order;
}

/**
 * The declared order list, then the same list again: the first pass forbids every contact, so each
 * currently selected lane layout keeps its exact geometry, and the bridged pass only runs once the
 * first has exhaustively failed, accepting a contact carried by a validated bridge (step 4 oracle).
 */
export function twoPassStrategies<Order extends string>(
	prefix: string,
	orders: readonly Order[],
): readonly LaneRouteStrategy<Order>[] {
	return [
		...orders.map((order) => ({ id: `${prefix}/${order}`, acceptBridges: false, order })),
		...orders.map((order) => ({ id: `${prefix}/bridged/${order}`, acceptBridges: true, order })),
	];
}
