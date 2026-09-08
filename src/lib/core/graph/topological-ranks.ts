import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { EndpointKind } from '../document/logic-document';
import type { LogicGraph } from './create-graph';

export interface TopologicalRanks {
	readonly byEndpointId: ReadonlyMap<string, number>;
	readonly bands: readonly (readonly string[])[];
}

function rankTargets(
	graph: LogicGraph,
	sourceId: string,
	ranks: Map<string, number>,
	indegree: Map<string, number>,
): readonly string[] {
	const sourceRank = defined(ranks.get(sourceId));
	const readyTargets: string[] = [];
	for (const target of defined(graph.outgoingByEndpointId.get(sourceId))) {
		const increment = graph.endpointsById.get(target)?.kind === EndpointKind.Junction ? 0 : 1;
		ranks.set(target, Math.max(defined(ranks.get(target)), sourceRank + increment));
		const remaining = defined(indegree.get(target)) - 1;
		indegree.set(target, remaining);
		if (remaining === 0) readyTargets.push(target);
	}
	return readyTargets;
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
			nextFrontier.push(...rankTargets(graph, id, ranks, indegree));
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
