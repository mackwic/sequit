import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';

export interface BranchAnchor {
	readonly parentId: string;
	readonly relationId: string;
}

/** Only direct, adjacent ordinary branches may move independently of their neighbors. */
export function branchAnchors(
	graph: LogicGraph,
	ranks: ReadonlyMap<string, number>,
): ReadonlyMap<string, BranchAnchor> {
	const fixed = new Set<string>();
	const outgoing = new Map<string, number>();
	for (const [id, endpoint] of graph.endpointsById) {
		if (endpoint.kind !== EndpointKind.Node || endpoint.entity.groupId !== undefined) fixed.add(id);
	}
	for (const { relation, source, target } of graph.relations) {
		outgoing.set(relation.from, (outgoing.get(relation.from) ?? 0) + 1);
		const adjacent = ranks.get(relation.from) === defined(ranks.get(relation.to)) + 1;
		const junction = source.kind === EndpointKind.Junction || target.kind === EndpointKind.Junction;
		if (!adjacent || junction) {
			fixed.add(relation.from);
			fixed.add(relation.to);
		}
	}
	const result = new Map<string, BranchAnchor>();
	for (const { relation, target } of graph.relations) {
		if (fixed.has(relation.from) || target.kind !== EndpointKind.Node) continue;
		if (target.entity.groupId !== undefined || outgoing.get(relation.from) !== 1) continue;
		result.set(relation.from, { parentId: relation.to, relationId: relation.id });
	}
	return result;
}
