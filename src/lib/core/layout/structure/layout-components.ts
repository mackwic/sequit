import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { GroupBlocks } from './group-blocks';

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

function rootIndex(parents: number[], index: number): number {
	let root = index;
	while (defined(parents[root]) !== root) root = defined(parents[root]);
	parents[index] = root;
	return root;
}

function outermostBlock(blocks: GroupBlocks, id: string): string | undefined {
	const outermost = blocks.chainOf(id)[0];
	if (outermost === undefined && blocks.ids.has(id)) return id;
	return outermost;
}

/** Join the two sets; returns whether they were distinct. */
function union(parents: number[], left: number, right: number): boolean {
	const leftRoot = rootIndex(parents, left);
	const rightRoot = rootIndex(parents, right);
	if (leftRoot === rightRoot) return false;
	parents[rightRoot] = leftRoot;
	return true;
}

/**
 * Weak components closed under containment: the ranked descendants of one outermost block
 * are laid out together, whatever relations connect them.
 */
export function rankedComponents(
	graph: LogicGraph,
	blocks: GroupBlocks,
): readonly (readonly string[])[] {
	const components = weaklyConnectedComponents(graph);
	if (blocks.ids.size === 0) return components;
	const parents = components.map((_, index) => index);
	const byBlock = new Map<string, number>();
	let merged = false;
	for (const [index, ids] of components.entries())
		for (const id of ids) {
			const outermost = outermostBlock(blocks, id);
			if (outermost === undefined) continue;
			const other = byBlock.get(outermost);
			if (other === undefined) byBlock.set(outermost, index);
			else merged = union(parents, other, index) || merged;
		}
	if (!merged) return components;
	const groups = new Map<number, string[]>();
	for (const [index, ids] of components.entries()) {
		const root = rootIndex(parents, index);
		const group = groups.get(root) ?? [];
		group.push(...ids);
		groups.set(root, group);
	}
	return [...groups.values()].map((ids) => ids.sort(compareCanonicalStrings));
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
