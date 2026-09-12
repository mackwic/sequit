import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';

function enqueueUnvisited(
	ids: Iterable<string>,
	visited: Set<string>,
	pending: string[],
	completed?: Set<Iterable<string>>,
): void {
	if (completed?.has(ids) === true) return;
	completed?.add(ids);
	for (const id of ids) {
		if (visited.has(id)) continue;
		visited.add(id);
		pending.push(id);
	}
}

export function weaklyConnectedComponents(graph: LogicGraph): readonly (readonly string[])[] {
	const visited = new Set<string>();
	const result: string[][] = [];
	const completedNeighbors = new Set<Iterable<string>>();
	for (const start of graph.rankableEndpointIds) {
		if (visited.has(start)) continue;
		const pending = [start];
		const component: string[] = [];
		visited.add(start);
		while (pending.length > 0) {
			const id = defined(pending.pop());
			component.push(id);
			enqueueUnvisited(
				defined(graph.outgoingByEndpointId.get(id)),
				visited,
				pending,
				completedNeighbors,
			);
			enqueueUnvisited(
				defined(graph.predecessorsByEndpointId.get(id)),
				visited,
				pending,
				completedNeighbors,
			);
		}
		component.sort(compareCanonicalStrings);
		result.push(component);
	}
	return result;
}

/** Relations plus containment form packing components distinct from rankable components. */
export function containmentComponents(
	graph: LogicGraph,
	packingOrder: readonly string[],
): readonly (readonly string[])[] {
	const adjacency = new Map<string, Set<string>>();
	const connect = (left: string, right: string): void => {
		if (!adjacency.has(left)) adjacency.set(left, new Set());
		if (!adjacency.has(right)) adjacency.set(right, new Set());
		defined(adjacency.get(left)).add(right);
		defined(adjacency.get(right)).add(left);
	};
	for (const { relation } of graph.relations) connect(relation.from, relation.to);
	for (const endpoint of graph.endpointsById.values()) {
		if (endpoint.entity.groupId !== undefined) connect(endpoint.entity.id, endpoint.entity.groupId);
	}
	const visited = new Set<string>();
	const components: string[][] = [];
	for (const start of packingOrder) {
		if (visited.has(start)) continue;
		const ids: string[] = [];
		const pending = [start];
		visited.add(start);
		while (pending.length > 0) {
			const id = defined(pending.pop());
			ids.push(id);
			enqueueUnvisited(adjacency.get(id) ?? [], visited, pending);
		}
		components.push(ids);
	}
	return components;
}
