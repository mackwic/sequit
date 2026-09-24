import { compareCanonicalStrings } from '../../../../lib/core/canonical-string';
import type { LogicDocument } from '../../../../lib/core/document/logic-document';
import { createGraph, type GraphDiagnostic } from '../../../../lib/core/graph/create-graph';

interface SourceAnchor {
	readonly endpointId: string;
	readonly visibleOwnerId: string;
}

interface VisibleOwner {
	readonly id: string;
	readonly sourceEndpointIds: readonly string[];
}

interface NormalizedLayoutRelation {
	readonly id: string;
	readonly from: SourceAnchor;
	readonly to: SourceAnchor;
}

/** Coordinate-free ownership and provenance for one visible document projection. */
export interface NormalizedLayoutGraph {
	readonly visibleOwners: readonly VisibleOwner[];
	readonly sourceAnchors: readonly SourceAnchor[];
	readonly relations: readonly NormalizedLayoutRelation[];
}

export type NormalizedLayoutGraphResult =
	| { readonly ok: true; readonly value: NormalizedLayoutGraph }
	| { readonly ok: false; readonly diagnostics: readonly GraphDiagnostic[] };

/** Validate source dependencies before visible ownership can collapse distinct endpoints. */
export function normalizeLayoutGraph(
	document: LogicDocument,
	collapsedGroupIds: readonly string[],
): NormalizedLayoutGraphResult {
	const source = createGraph(document);
	if (!source.ok) return source;

	const endpoints = [...source.value.endpointsById.values()];
	const parentByEndpointId = new Map(endpoints.map(({ entity }) => [entity.id, entity.groupId]));
	const collapsed = new Set(collapsedGroupIds);
	const sourceAnchors = endpoints
		.map(({ entity }): SourceAnchor => {
			let visibleOwnerId = entity.id;
			let ancestor: string | undefined = entity.id;
			while (ancestor !== undefined) {
				if (collapsed.has(ancestor)) visibleOwnerId = ancestor;
				ancestor = parentByEndpointId.get(ancestor);
			}
			return { endpointId: entity.id, visibleOwnerId };
		})
		.toSorted((a, b) => compareCanonicalStrings(a.endpointId, b.endpointId));
	const anchorByEndpointId = new Map(sourceAnchors.map((anchor) => [anchor.endpointId, anchor]));
	const membersByOwnerId = new Map<string, string[]>();
	for (const anchor of sourceAnchors) {
		const members = membersByOwnerId.get(anchor.visibleOwnerId) ?? [];
		members.push(anchor.endpointId);
		membersByOwnerId.set(anchor.visibleOwnerId, members);
	}
	const visibleOwners = [...membersByOwnerId]
		.toSorted(([a], [b]) => compareCanonicalStrings(a, b))
		.map(([id, sourceEndpointIds]) => ({ id, sourceEndpointIds }));
	const relations = source.value.relations.map(({ relation }): NormalizedLayoutRelation => {
		const from = anchorByEndpointId.get(relation.from);
		const to = anchorByEndpointId.get(relation.to);
		if (from === undefined || to === undefined)
			throw new Error('Validated relation lost its endpoint');
		return { id: relation.id, from, to };
	});
	return { ok: true, value: { visibleOwners, sourceAnchors, relations } };
}
