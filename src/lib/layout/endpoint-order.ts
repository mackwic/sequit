export interface EndpointRows {
	readonly ordinary: readonly (readonly string[])[];
	readonly junction: readonly (readonly string[])[];
}

export function deriveEffectiveEndpointOrder(
	persistedEndpointOrder: readonly string[] | undefined,
	endpointIds: readonly string[],
): readonly string[] {
	const currentIds = new Set(endpointIds);
	const included = new Set<string>();
	const effective: string[] = [];
	for (const id of persistedEndpointOrder ?? []) {
		if (!currentIds.has(id) || included.has(id)) continue;
		included.add(id);
		effective.push(id);
	}
	for (const id of [...currentIds].sort((left, right) => left.localeCompare(right))) {
		if (included.has(id)) continue;
		included.add(id);
		effective.push(id);
	}
	return effective;
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
