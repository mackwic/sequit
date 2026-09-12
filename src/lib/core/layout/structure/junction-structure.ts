import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';

export interface JunctionPlacement {
	readonly interval: number;
	readonly depth: number;
	readonly neighbors: readonly string[];
}

function mergeNeighbors(
	children: readonly string[],
	neighbors: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
	const ordinary = new Set<string>();
	for (const child of children)
		for (const node of neighbors.get(child) ?? [child]) ordinary.add(node);
	return [...ordinary];
}

/** Resolve ordinary successors bottom-up, avoiding recursion even for long junction chains. */
function ordinarySuccessors(
	graph: LogicGraph,
	ids: ReadonlySet<string>,
): Map<string, readonly string[]> {
	const remaining = new Map<string, number>();
	const ready: string[] = [];
	const neighbors = new Map<string, readonly string[]>();
	for (const id of ids) {
		const count = defined(graph.predecessorsByEndpointId.get(id)).filter((child) =>
			ids.has(child),
		).length;
		remaining.set(id, count);
		if (count === 0) ready.push(id);
	}
	for (const id of ready) {
		neighbors.set(id, mergeNeighbors(defined(graph.predecessorsByEndpointId.get(id)), neighbors));
		for (const parent of defined(graph.outgoingByEndpointId.get(id))) {
			const count = remaining.get(parent);
			if (count === undefined) continue;
			remaining.set(parent, count - 1);
			if (count === 1) ready.push(parent);
		}
	}
	return neighbors;
}

/** Junction rails belong to physical intervals; logical ranks remain unchanged. */
export function prepareJunctions(
	graph: LogicGraph,
	rows: ReadonlyMap<string, number>,
): ReadonlyMap<string, JunctionPlacement> {
	const ids = new Set(graph.document.junctions.map(({ id }) => id));
	const successors = ordinarySuccessors(graph, ids);
	const intervals = new Map<string, number>();
	for (const id of ids) {
		const neighbors = defined(successors.get(id));
		let interval = defined(rows.get(id));
		if (neighbors.length > 0)
			interval = Math.min(...neighbors.map((node) => defined(rows.get(node)))) - 1;
		intervals.set(id, Math.max(0, interval));
	}
	const result = new Map<string, JunctionPlacement>();
	// Successors were inserted before parents; reverse that order for progressive depths.
	for (const id of [...successors.keys()].reverse()) {
		const interval = defined(intervals.get(id));
		let depth = 0;
		for (const parent of defined(graph.outgoingByEndpointId.get(id))) {
			const previous = result.get(parent);
			if (previous?.interval === interval) depth = Math.max(depth, previous.depth + 1);
		}
		const neighbors = defined(successors.get(id)).filter((node) => rows.get(node) === interval + 1);
		result.set(id, { interval, depth, neighbors });
	}
	return result;
}
