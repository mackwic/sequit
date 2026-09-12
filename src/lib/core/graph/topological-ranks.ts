import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { EndpointKind } from '../document/logic-document';
import type { LogicGraph } from './create-graph';

export interface TopologicalRanks {
	readonly byEndpointId: ReadonlyMap<string, number>;
	readonly bands: readonly (readonly string[])[];
}

interface ParentBatch {
	readonly children: readonly string[];
	count: number;
	maximumRank: number;
}

function parentBatches(
	graph: LogicGraph,
	frontier: readonly string[],
	ranks: ReadonlyMap<string, number>,
): Iterable<ParentBatch> {
	const batches = new Map<readonly string[], ParentBatch>();
	for (const id of frontier) {
		const children = defined(graph.predecessorsByEndpointId.get(id));
		const rank = defined(ranks.get(id));
		const known = batches.get(children);
		if (known === undefined) batches.set(children, { children, count: 1, maximumRank: rank });
		else {
			known.count += 1;
			known.maximumRank = Math.max(known.maximumRank, rank);
		}
	}
	return batches.values();
}

function rankChildren(
	graph: LogicGraph,
	batch: ParentBatch,
	ranks: Map<string, number>,
	remainingParents: Map<string, number>,
): readonly string[] {
	const readyChildren: string[] = [];
	for (const child of batch.children) {
		const increment = graph.endpointsById.get(child)?.kind === EndpointKind.Junction ? 0 : 1;
		ranks.set(child, Math.max(defined(ranks.get(child)), batch.maximumRank + increment));
		const remaining = defined(remainingParents.get(child)) - batch.count;
		remainingParents.set(child, remaining);
		if (remaining === 0) readyChildren.push(child);
	}
	return readyChildren;
}
/** Zero-based longest-path ranks from roots, traversing child → parent relations in reverse.
 * Junctions occupy the interval after their parent rank without adding a node rank.
 */
export function topologicallyRank(graph: LogicGraph): TopologicalRanks {
	const remainingParents = new Map(
		graph.rankableEndpointIds.map((id) => [id, defined(graph.outgoingByEndpointId.get(id)).length]),
	);
	const ranks = new Map(graph.rankableEndpointIds.map((id) => [id, 0]));
	let frontier = graph.rankableEndpointIds.filter((id) => remainingParents.get(id) === 0);
	let processed = 0;

	while (frontier.length > 0) {
		const nextFrontier: string[] = [];
		processed += frontier.length;
		for (const batch of parentBatches(graph, frontier, ranks)) {
			nextFrontier.push(...rankChildren(graph, batch, ranks, remainingParents));
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
