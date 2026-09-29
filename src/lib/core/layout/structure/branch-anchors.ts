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
	const candidates = new Map<string, BranchAnchor | null>();
	for (const { relation, target } of graph.relations) {
		let anchor: BranchAnchor | null = null;
		const adjacent = ranks.get(relation.from) === (ranks.get(relation.to) ?? 0) + 1;
		if (target.kind === EndpointKind.Node && adjacent)
			anchor = { parentId: relation.to, relationId: relation.id };
		if (candidates.has(relation.from)) anchor = null;
		candidates.set(relation.from, anchor);
	}
	const result = new Map<string, BranchAnchor>();
	for (const [id, anchor] of candidates) if (anchor !== null) result.set(id, anchor);
	return result;
}
