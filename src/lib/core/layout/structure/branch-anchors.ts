import { EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';

export interface BranchAnchor {
	readonly parentId: string;
	readonly relationId: string;
}

/**
 * An endpoint with a single outgoing relation to an ordinary node in the adjacent rank may
 * follow that relation's actual ports, so a lone child stays straight below an offset port.
 */
export function branchAnchors(
	graph: LogicGraph,
	ranks: ReadonlyMap<string, number>,
): ReadonlyMap<string, BranchAnchor> {
	const lone = new Map<string, LogicGraph['relations'][number] | undefined>();
	for (const entry of graph.relations) {
		const from = entry.relation.from;
		if (lone.has(from)) lone.set(from, undefined);
		else lone.set(from, entry);
	}
	const result = new Map<string, BranchAnchor>();
	for (const [id, entry] of lone) {
		if (entry?.target.kind !== EndpointKind.Node) continue;
		const { relation } = entry;
		if (ranks.get(relation.from) !== (ranks.get(relation.to) ?? 0) + 1) continue;
		result.set(id, { parentId: relation.to, relationId: relation.id });
	}
	return result;
}
