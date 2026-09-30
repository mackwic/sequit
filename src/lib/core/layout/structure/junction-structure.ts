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

/**
 * A junction rail sits just before its nearest ordinary child. Without one, it keeps its own
 * rank, yet never precedes a junction it feeds: that junction's rail may lie further along.
 */
function junctionInterval(
	rank: number,
	childRows: readonly number[],
	parentIntervals: readonly number[],
): number {
	if (childRows.length > 0) return Math.max(0, Math.min(...childRows) - 1);
	return Math.max(rank, ...parentIntervals);
}

/** Junction rails belong to physical intervals; logical ranks remain unchanged. */
export function prepareJunctions(
	graph: LogicGraph,
	rows: ReadonlyMap<string, number>,
): ReadonlyMap<string, JunctionPlacement> {
	const ids = new Set(graph.document.junctions.map(({ id }) => id));
	const successors = ordinarySuccessors(graph, ids);
	const result = new Map<string, JunctionPlacement>();
	// Successors were inserted before parents; reverse that order to place parents first.
	for (const id of [...successors.keys()].reverse()) {
		const parents = defined(graph.outgoingByEndpointId.get(id));
		const children = defined(successors.get(id));
		const interval = junctionInterval(
			defined(rows.get(id)),
			children.map((node) => defined(rows.get(node))),
			parents.map((parent) => result.get(parent)?.interval ?? 0),
		);
		let depth = 0;
		for (const parent of parents) {
			const previous = result.get(parent);
			if (previous?.interval === interval) depth = Math.max(depth, previous.depth + 1);
		}
		let neighbors = children.filter((node) => rows.get(node) === interval + 1);
		// Without children beside it, a junction faces the parents of its own row instead.
		if (neighbors.length === 0)
			neighbors = parents.filter((node) => !ids.has(node) && rows.get(node) === interval);
		result.set(id, { interval, depth, neighbors });
	}
	return result;
}
