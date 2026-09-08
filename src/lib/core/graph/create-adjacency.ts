import { compareCanonicalStrings } from '../canonical-string';
import { defined, EndpointKind } from '../document/logic-document';

interface AdjacencyEndpoint {
	readonly kind: EndpointKind;
	readonly entity: { readonly id: string };
}

interface AdjacencyRelation {
	readonly source: AdjacencyEndpoint;
	readonly target: AdjacencyEndpoint;
}

interface EffectiveRelation {
	readonly sourceIds: readonly string[];
	readonly targetIds: readonly string[];
}

export interface GraphAdjacency {
	readonly outgoing: Map<string, string[]>;
	readonly predecessors: Map<string, string[]>;
}

function appendAdjacency(
	keys: readonly string[],
	adjacentIds: readonly string[],
	adjacency: Map<string, Set<string>>,
): void {
	for (const key of keys) {
		const values = defined(adjacency.get(key));
		for (const adjacentId of adjacentIds) values.add(adjacentId);
	}
}

function canonicalizeAdjacency(
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, string[]> {
	return new Map(
		[...adjacency].map(([id, adjacent]) => [id, [...adjacent].sort(compareCanonicalStrings)]),
	);
}

function adjacencyEndpointIds(
	relation: AdjacencyRelation,
	effectiveRelation: EffectiveRelation,
): EffectiveRelation {
	const { sourceIds, targetIds } = effectiveRelation;
	const includesGroup =
		relation.source.kind === EndpointKind.Group || relation.target.kind === EndpointKind.Group;
	const targets = new Set(targetIds);
	if (!includesGroup || !sourceIds.some((id) => targets.has(id))) return effectiveRelation;
	return { sourceIds: [relation.source.entity.id], targetIds: [relation.target.entity.id] };
}

export function createAdjacency(
	endpointIds: readonly string[],
	relations: readonly AdjacencyRelation[],
	effectiveRelations: readonly EffectiveRelation[],
): GraphAdjacency {
	const outgoingSets = new Map(endpointIds.map((id) => [id, new Set<string>()]));
	const predecessorSets = new Map(endpointIds.map((id) => [id, new Set<string>()]));
	for (let index = 0; index < effectiveRelations.length; index += 1) {
		const effectiveRelation = defined(effectiveRelations[index]);
		const relation = defined(relations[index]);
		const { sourceIds, targetIds } = adjacencyEndpointIds(relation, effectiveRelation);
		appendAdjacency(sourceIds, targetIds, outgoingSets);
		appendAdjacency(targetIds, sourceIds, predecessorSets);
	}
	return {
		outgoing: canonicalizeAdjacency(outgoingSets),
		predecessors: canonicalizeAdjacency(predecessorSets),
	};
}
