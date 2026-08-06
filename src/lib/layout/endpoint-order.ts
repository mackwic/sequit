import { compareCanonicalStrings } from '../canonical-string';
import type { LogicEndpoint } from '../document/logic-document';
import { fractionalOrderKeySpace, type OrderKeySpace } from './order-key-space';

export interface EndpointRows {
	readonly ordinary: readonly (readonly string[])[];
	readonly junction: readonly (readonly string[])[];
}

export function orderEndpoints(
	endpoints: readonly LogicEndpoint[],
	keySpace: OrderKeySpace = fractionalOrderKeySpace,
): readonly string[] {
	return [...endpoints]
		.sort(
			(left, right) =>
				keySpace.compare(left.layoutOrder, right.layoutOrder) ||
				compareCanonicalStrings(left.id, right.id),
		)
		.map(({ id }) => id);
}

interface EndpointRowInput {
	effectiveEndpointOrder: readonly string[];
	componentIds: readonly string[];
	ranks: ReadonlyMap<string, number>;
	junctionIds: ReadonlySet<string>;
	maximumRank: number;
}

type EndpointRowArguments =
	| readonly [input: EndpointRowInput]
	| readonly [
			effectiveEndpointOrder: readonly string[],
			componentIds: readonly string[],
			ranks: ReadonlyMap<string, number>,
			junctionIds: ReadonlySet<string>,
			maximumRank: number,
	  ];

export function deriveEndpointRows(...args: EndpointRowArguments): EndpointRows {
	let input: EndpointRowInput;
	if (args.length === 1) {
		[input] = args;
	} else {
		const [effectiveEndpointOrder, componentIds, ranks, junctionIds, maximumRank] = args;
		input = { effectiveEndpointOrder, componentIds, ranks, junctionIds, maximumRank };
	}
	const { effectiveEndpointOrder, componentIds, ranks, junctionIds, maximumRank } = input;
	const ordinary = Array.from({ length: maximumRank + 1 }, () => [] as string[]);
	const junction = Array.from({ length: maximumRank + 1 }, () => [] as string[]);
	const component = new Set(componentIds);
	for (const id of effectiveEndpointOrder) {
		if (!component.has(id)) continue;
		const rank = ranks.get(id);
		const rankExists = rank !== undefined;
		const negativeRank = rankExists && rank < 0;
		const nonIntegerRank = rankExists && !Number.isInteger(rank);
		const invalidNumber = negativeRank || nonIntegerRank;
		const outOfRange = rankExists && rank > maximumRank;
		if (rank === undefined || invalidNumber || outOfRange) {
			throw new Error(`Invalid layout rank: ${id}`);
		}
		let rows = ordinary;
		if (junctionIds.has(id)) rows = junction;
		rows[rank]?.push(id);
	}
	return { ordinary, junction };
}
