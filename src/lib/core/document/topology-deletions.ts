import { EndpointKind, type LogicDocument } from './logic-document';
import type { DocumentChangeSet } from './topology-edits';

/** Remove selected endpoints, group descendants, and every incident relation atomically. */
export function projectDeletion(
	document: LogicDocument,
	endpointIds: readonly string[],
	relationIds: readonly string[],
): DocumentChangeSet {
	const removed = new Set(endpointIds);
	const endpoints = [...document.groups, ...document.nodes, ...document.junctions];
	let changed = true;
	while (changed) {
		changed = false;
		for (const endpoint of endpoints) {
			if (endpoint.groupId === undefined || removed.has(endpoint.id)) continue;
			if (!removed.has(endpoint.groupId)) continue;
			removed.add(endpoint.id);
			changed = true;
		}
	}
	const relations = new Set(relationIds);
	for (const relation of document.relations) {
		if (removed.has(relation.from) || removed.has(relation.to)) relations.add(relation.id);
	}
	return {
		nodeAdditions: [],
		relationAdditions: [],
		endpointOrderChanges: [],
		nodeMarkdownReplacements: [],
		endpointRemovals: [
			...document.nodes
				.filter(({ id }) => removed.has(id))
				.map(({ id }) => ({ endpointKind: EndpointKind.Node, endpointId: id })),
			...document.junctions
				.filter(({ id }) => removed.has(id))
				.map(({ id }) => ({ endpointKind: EndpointKind.Junction, endpointId: id })),
			...document.groups
				.filter(({ id }) => removed.has(id))
				.map(({ id }) => ({ endpointKind: EndpointKind.Group, endpointId: id })),
		],
		relationRemovals: [...relations],
	};
}
