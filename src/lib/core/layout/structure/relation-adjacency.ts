import type { LogicGraph } from '../../graph/create-graph';

export interface RawAdjacency {
	readonly parents: ReadonlyMap<string, readonly string[]>;
	readonly children: ReadonlyMap<string, readonly string[]>;
}

const adjacencies = new WeakMap<LogicGraph, RawAdjacency>();

/** Relations as documented: a relation to a group reaches its frame, not its members. */
export function rawAdjacency(graph: LogicGraph): RawAdjacency {
	const cached = adjacencies.get(graph);
	if (cached !== undefined) return cached;
	const parents = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	const add = (edges: Map<string, string[]>, from: string, to: string): void => {
		const list = edges.get(from) ?? [];
		list.push(to);
		edges.set(from, list);
	};
	for (const { relation } of graph.relations) {
		add(parents, relation.from, relation.to);
		add(children, relation.to, relation.from);
	}
	const adjacency = { parents, children };
	adjacencies.set(graph, adjacency);
	return adjacency;
}

/** Related ordinary endpoints, looking through junctions. */
export function throughJunctions(
	id: string,
	edges: ReadonlyMap<string, readonly string[]>,
	junctionIds: ReadonlySet<string>,
): ReadonlySet<string> {
	const direct = edges.get(id) ?? [];
	if (!direct.some((next) => junctionIds.has(next))) return new Set(direct);
	const found = new Set<string>();
	const seen = new Set<string>();
	const pending = [...direct];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (seen.has(next)) continue;
		seen.add(next);
		if (junctionIds.has(next)) pending.push(...(edges.get(next) ?? []));
		else found.add(next);
	}
	return found;
}
