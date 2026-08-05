export interface EndpointRows {
	readonly ordinary: readonly (readonly string[])[];
	readonly junction: readonly (readonly string[])[];
}

export function orderEndpoints(
	endpoints: readonly LogicEndpoint[],
	keySpace: OrderKeySpace = fractionalOrderKeySpace,
): readonly string[] {
	return [...endpoints]
		.sort((left, right) => {
			if (left.layoutOrder === undefined)
				return right.layoutOrder === undefined ? left.id.localeCompare(right.id) : 1;
			if (right.layoutOrder === undefined) return -1;
			return (
				keySpace.compare(left.layoutOrder, right.layoutOrder) || left.id.localeCompare(right.id)
			);
		})
		.map(({ id }) => id);
}

export function deriveEndpointRows(
	effectiveEndpointOrder: readonly string[],
	componentIds: readonly string[],
	ranks: ReadonlyMap<string, number>,
	junctionIds: ReadonlySet<string>,
	maximumRank: number,
): EndpointRows {
	const ordinary = Array.from({ length: maximumRank + 1 }, () => [] as string[]);
	const junction = Array.from({ length: maximumRank + 1 }, () => [] as string[]);
	const component = new Set(componentIds);
	for (const id of effectiveEndpointOrder) {
		if (!component.has(id)) continue;
		const rank = ranks.get(id);
		if (rank === undefined || rank < 0 || !Number.isInteger(rank) || rank > maximumRank) {
			throw new Error(`Invalid layout rank: ${id}`);
		}
		(junctionIds.has(id) ? junction : ordinary)[rank]?.push(id);
	}
	return { ordinary, junction };
}
import type { LogicEndpoint } from '../document/logic-document';
import { fractionalOrderKeySpace, type OrderKeySpace } from './order-key-space';
