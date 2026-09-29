import { EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';

/**
 * Groups enclosing a ranked ordinary endpoint. In layout each one is a rigid block: in every
 * row it spans, it occupies one contiguous slot of its container at one transverse position.
 */
export interface GroupBlocks {
	readonly ids: ReadonlySet<string>;
	/** Blocks enclosing an endpoint, outermost first; empty at the root. */
	readonly chainOf: (id: string) => readonly string[];
}

const cache = new WeakMap<LogicGraph, GroupBlocks>();

function parentOf(graph: LogicGraph, id: string): string | undefined {
	return graph.endpointsById.get(id)?.entity.groupId;
}

function blockIds(graph: LogicGraph): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const id of graph.rankableEndpointIds) {
		if (graph.endpointsById.get(id)?.kind === EndpointKind.Junction) continue;
		for (let group = parentOf(graph, id); group !== undefined; group = parentOf(graph, group)) {
			if (ids.has(group)) break;
			ids.add(group);
		}
	}
	return ids;
}

/** Blocks and their nesting for a graph; rows, rank orders and placement share one instance. */
export function groupBlocks(graph: LogicGraph): GroupBlocks {
	const cached = cache.get(graph);
	if (cached !== undefined) return cached;
	const ids = blockIds(graph);
	const chains = new Map<string, readonly string[]>();
	const chainOf = (id: string): readonly string[] => {
		const known = chains.get(id);
		if (known !== undefined) return known;
		const chain: string[] = [];
		for (let group = parentOf(graph, id); group !== undefined; group = parentOf(graph, group))
			if (ids.has(group)) chain.push(group);
		chain.reverse();
		chains.set(id, chain);
		return chain;
	};
	const blocks = { ids, chainOf };
	cache.set(graph, blocks);
	return blocks;
}

/** The item standing for an endpoint in a container's rows: itself or its enclosing block. */
export function itemIn(blocks: GroupBlocks, container: string | undefined, id: string): string {
	const chain = blocks.chainOf(id);
	let depth = 0;
	if (container !== undefined) depth = chain.indexOf(container) + 1;
	return chain[depth] ?? id;
}
