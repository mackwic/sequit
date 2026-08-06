import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { EndpointKind } from '../document/logic-document';
import type { LogicGraph } from './create-graph';

export interface TopologicalRanks {
	readonly byEndpointId: ReadonlyMap<string, number>;
	readonly bands: readonly (readonly string[])[];
}

export function topologicallyRank(graph: LogicGraph): TopologicalRanks {
	const indegree = new Map(
		graph.rankableEndpointIds.map((id) => [
			id,
			defined(graph.predecessorsByEndpointId.get(id)).length,
		]),
	);
	const ranks = new Map(graph.rankableEndpointIds.map((id) => [id, 0]));
	let frontier = graph.rankableEndpointIds.filter((id) => indegree.get(id) === 0);
	let processed = 0;

	while (frontier.length > 0) {
		const nextFrontier: string[] = [];
		for (const id of frontier) {
			processed += 1;
			const sourceRank = defined(ranks.get(id));
			for (const target of defined(graph.outgoingByEndpointId.get(id))) {
				const increment = graph.endpointsById.get(target)?.kind === EndpointKind.Junction ? 0 : 1;
				ranks.set(target, Math.max(defined(ranks.get(target)), sourceRank + increment));
				const remaining = defined(indegree.get(target)) - 1;
				indegree.set(target, remaining);
				if (remaining === 0) nextFrontier.push(target);
			}
		}
		nextFrontier.sort(compareCanonicalStrings);
		frontier = nextFrontier;
	}

	if (processed !== graph.rankableEndpointIds.length) {
		throw new Error('LogicGraph must be acyclic before ranking');
	}

	const maxRank = Math.max(0, ...ranks.values());
	const bands = Array.from({ length: maxRank + 1 }, () => [] as string[]);
	for (const [id, rank] of ranks) bands[rank]?.push(id);
	return { byEndpointId: ranks, bands };
}
