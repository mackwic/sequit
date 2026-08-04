import type { LogicGraph } from './create-graph';

export interface TopologicalRanks {
	readonly byEndpointId: ReadonlyMap<string, number>;
	readonly bands: readonly (readonly string[])[];
}

export function topologicallyRank(graph: LogicGraph): TopologicalRanks {
	const indegree = new Map(
		graph.rankableEndpointIds.map((id) => [
			id,
			graph.predecessorsByEndpointId.get(id)?.length ?? 0,
		]),
	);
	const ranks = new Map(graph.rankableEndpointIds.map((id) => [id, 0]));
	let frontier = graph.rankableEndpointIds.filter((id) => indegree.get(id) === 0);
	let processed = 0;

	while (frontier.length > 0) {
		const nextFrontier: string[] = [];
		for (const id of frontier) {
			processed += 1;
			const sourceRank = ranks.get(id);
			/* istanbul ignore if -- @preserve: every frontier ID is initialized in the ranks map. */
			if (sourceRank === undefined) throw new Error(`Missing topological rank: ${id}`);
			for (const target of graph.outgoingByEndpointId.get(id) ?? []) {
				const rankIncrement = graph.endpointsById.get(target)?.kind === 'junction' ? 0 : 1;
				ranks.set(target, Math.max(ranks.get(target) ?? 0, sourceRank + rankIncrement));
				const remaining = (indegree.get(target) ?? 0) - 1;
				indegree.set(target, remaining);
				if (remaining === 0) nextFrontier.push(target);
			}
		}
		nextFrontier.sort((left, right) => left.localeCompare(right));
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
