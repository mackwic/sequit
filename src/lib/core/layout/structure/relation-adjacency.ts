import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { groupBlocks } from './group-blocks';

export interface RawAdjacency {
	readonly parents: ReadonlyMap<string, readonly string[]>;
	readonly children: ReadonlyMap<string, readonly string[]>;
}

const adjacencies = new WeakMap<LogicGraph, RawAdjacency>();

/**
 * Relations as documented: a relation to a block reaches its frame, not its members. A group
 * that is no block has no slot of its own when it holds junctions: they stand for it.
 */
export function rawAdjacency(graph: LogicGraph): RawAdjacency {
	const cached = adjacencies.get(graph);
	if (cached !== undefined) return cached;
	const blocks = groupBlocks(graph).ids;
	const parents = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	const add = (edges: Map<string, string[]>, from: string, to: string): void => {
		const list = edges.get(from) ?? [];
		list.push(to);
		edges.set(from, list);
	};
	const standIns = (id: string, effective: readonly string[]): readonly string[] => {
		if (blocks.has(id)) return [id];
		return effective;
	};
	for (const [index, { relation }] of graph.relations.entries()) {
		const effective = defined(graph.effectiveRelations[index]);
		for (const source of standIns(relation.from, effective.sourceIds))
			for (const target of standIns(relation.to, effective.targetIds)) {
				add(parents, source, target);
				add(children, target, source);
			}
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
