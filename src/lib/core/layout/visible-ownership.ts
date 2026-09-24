import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';

interface VisibleSourceAnchor {
	readonly endpointId: string;
	readonly visibleOwnerId: string;
}

interface VisibleOwner {
	readonly id: string;
	readonly sourceEndpointIds: readonly string[];
}

export interface VisibleSourceRelation {
	readonly id: string;
	readonly from: VisibleSourceAnchor;
	readonly to: VisibleSourceAnchor;
}

/** Source identity and visible ownership are separate, even when folding creates a visible cycle. */
export interface NormalizedVisibleOwnership {
	readonly visibleOwners: readonly VisibleOwner[];
	readonly sourceAnchors: readonly VisibleSourceAnchor[];
	readonly relations: readonly VisibleSourceRelation[];
}

/** The outermost collapsed ancestor owns an endpoint; source relations keep their original ends. */
export function normalizeVisibleOwnership(
	graph: LogicGraph,
	collapsedGroupIds: readonly string[],
): NormalizedVisibleOwnership {
	const collapsed = new Set(collapsedGroupIds);
	const parentByEndpointId = new Map(
		[...graph.endpointsById.values()].map(({ entity }) => [entity.id, entity.groupId]),
	);
	const sourceAnchors = [...graph.endpointsById.keys()]
		.map((endpointId): VisibleSourceAnchor => {
			let visibleOwnerId = endpointId;
			let ancestor: string | undefined = endpointId;
			while (ancestor !== undefined) {
				if (collapsed.has(ancestor)) visibleOwnerId = ancestor;
				ancestor = parentByEndpointId.get(ancestor);
			}
			return { endpointId, visibleOwnerId };
		})
		.sort((a, b) => compareCanonicalStrings(a.endpointId, b.endpointId));
	const anchorByEndpointId = new Map(sourceAnchors.map((anchor) => [anchor.endpointId, anchor]));
	const membersByOwnerId = new Map<string, string[]>();
	for (const anchor of sourceAnchors) {
		const members = membersByOwnerId.get(anchor.visibleOwnerId) ?? [];
		members.push(anchor.endpointId);
		membersByOwnerId.set(anchor.visibleOwnerId, members);
	}
	const visibleOwners = [...membersByOwnerId]
		.sort(([a], [b]) => compareCanonicalStrings(a, b))
		.map(([id, sourceEndpointIds]) => ({ id, sourceEndpointIds }));
	const relations = graph.relations.map(({ relation }): VisibleSourceRelation => {
		const from = defined(anchorByEndpointId.get(relation.from));
		const to = defined(anchorByEndpointId.get(relation.to));
		return { id: relation.id, from, to };
	});
	return { visibleOwners, sourceAnchors, relations };
}
