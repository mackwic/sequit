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
	readonly outgoing: ReadonlyMap<string, readonly string[]>;
	readonly predecessors: ReadonlyMap<string, readonly string[]>;
}

interface AdjacencyEntry {
	readonly ids: Set<string>;
	readonly shared: boolean;
}

/** A group relation can give many endpoints the same neighbors. Copy only before divergence. */
function appendAdjacency(
	keys: readonly string[],
	adjacentIds: readonly string[],
	adjacency: Map<string, AdjacencyEntry>,
): void {
	let shared: AdjacencyEntry | undefined;
	for (const key of keys) {
		let entry = defined(adjacency.get(key));
		if (entry.shared) {
			if (entry.ids.size === 0 && keys.length > 1) {
				shared ??= { ids: new Set(adjacentIds), shared: true };
				adjacency.set(key, shared);
				continue;
			}
			entry = { ids: new Set(entry.ids), shared: false };
			adjacency.set(key, entry);
		}
		for (const id of adjacentIds) entry.ids.add(id);
	}
}

function canonicalizeAdjacency(
	adjacency: ReadonlyMap<string, AdjacencyEntry>,
): ReadonlyMap<string, readonly string[]> {
	const canonical = new Map<AdjacencyEntry, readonly string[]>();
	const result = new Map<string, readonly string[]>();
	for (const [id, entry] of adjacency) {
		let ids = canonical.get(entry);
		if (ids === undefined) {
			ids = [...entry.ids].sort(compareCanonicalStrings);
			canonical.set(entry, ids);
		}
		result.set(id, ids);
	}
	return result;
}

function adjacencyEndpointIds(
	relation: AdjacencyRelation,
	effectiveRelation: EffectiveRelation,
): EffectiveRelation {
	const { sourceIds, targetIds } = effectiveRelation;
	const includesGroup =
		relation.source.kind === EndpointKind.Group || relation.target.kind === EndpointKind.Group;
	if (!includesGroup) return effectiveRelation;
	const targets = new Set(targetIds);
	if (!sourceIds.some((id) => targets.has(id))) return effectiveRelation;
	return { sourceIds: [relation.source.entity.id], targetIds: [relation.target.entity.id] };
}

export function createAdjacency(
	endpointIds: readonly string[],
	relations: readonly AdjacencyRelation[],
	effectiveRelations: readonly EffectiveRelation[],
): GraphAdjacency {
	const empty: AdjacencyEntry = { ids: new Set(), shared: true };
	const outgoingSets = new Map(endpointIds.map((id) => [id, empty]));
	const predecessorSets = new Map(endpointIds.map((id) => [id, empty]));
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
