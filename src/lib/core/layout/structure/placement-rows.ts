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
}): PlacementRows {
	return deriveEndpointRows({
		effectiveEndpointOrder: [...input.ids].sort(
			(left, right) => defined(input.orderById.get(left)) - defined(input.orderById.get(right)),
		),
		componentIds: input.ids,
		ranks: input.ranks,
		junctionIds: input.junctionIds,
		maximumRank: input.maximumRank,
	});
}
