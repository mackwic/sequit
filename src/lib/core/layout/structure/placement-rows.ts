import { defined } from '../../document/logic-document';
import { deriveEndpointRows, type EndpointRows } from '../../ordering/endpoint-order';

/** Placement rows currently follow logical rank; junction rows occupy the following interval. */
export type PlacementRows = EndpointRows;

export interface RankedComponent {
	readonly ids: readonly string[];
	readonly context: string;
	readonly effectiveOrder: number;
	readonly rows: PlacementRows;
}

export function preparePlacementRows(input: {
	readonly ids: readonly string[];
	readonly orderById: ReadonlyMap<string, number>;
	readonly ranks: ReadonlyMap<string, number>;
	readonly junctionIds: ReadonlySet<string>;
	readonly maximumRank: number;
	readonly ordinaryOrder?: readonly string[];
}): PlacementRows {
	const documentaryOrder = [...input.ids].sort(
		(left, right) => defined(input.orderById.get(left)) - defined(input.orderById.get(right)),
	);
	const ordinaryIds =
		input.ordinaryOrder ?? documentaryOrder.filter((id) => !input.junctionIds.has(id));
	const junctionIds = documentaryOrder.filter((id) => input.junctionIds.has(id));
	return deriveEndpointRows({
		effectiveEndpointOrder: [...ordinaryIds, ...junctionIds],
		componentIds: input.ids,
		ranks: input.ranks,
		junctionIds: input.junctionIds,
		maximumRank: input.maximumRank,
	});
}
