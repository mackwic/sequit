import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';

export interface BranchAnchor {
	readonly parentId: string;
	readonly relationId: string;
}

function recordSingleOutgoing(
	candidates: Map<string, BranchAnchor | null>,
	entry: LogicGraph['relations'][number],
): void {
	const { relation, target } = entry;
	const first = candidates.get(relation.from);
	if (first === null) return;
	if (first !== undefined) {
		candidates.set(relation.from, null);
		return;
	}
	let anchor: BranchAnchor | null = null;
	if (target.kind === EndpointKind.Node && target.entity.groupId === undefined)
		anchor = { parentId: relation.to, relationId: relation.id };
	candidates.set(relation.from, anchor);
}

/** Only direct, adjacent ordinary branches may move independently of their neighbors. */
export function branchAnchors(
	graph: LogicGraph,
	ranks: ReadonlyMap<string, number>,
): ReadonlyMap<string, BranchAnchor> {
	const fixed = new Set<string>();
	const singleOutgoing = new Map<string, BranchAnchor | null>();
	for (const [id, endpoint] of graph.endpointsById) {
		if (endpoint.kind !== EndpointKind.Node || endpoint.entity.groupId !== undefined) fixed.add(id);
	}
	for (const entry of graph.relations) {
		const { relation, source, target } = entry;
		recordSingleOutgoing(singleOutgoing, entry);
		const adjacent = ranks.get(relation.from) === defined(ranks.get(relation.to)) + 1;
		const junction = source.kind === EndpointKind.Junction || target.kind === EndpointKind.Junction;
		if (!adjacent || junction) {
			fixed.add(relation.from);
			fixed.add(relation.to);
		}
	}
	const result = new Map<string, BranchAnchor>();
	for (const [id, anchor] of singleOutgoing)
		if (anchor !== null && !fixed.has(id)) result.set(id, anchor);
	return result;
}
