import { EndpointKind, type LogicDocument, type LogicRelation } from './logic-document';
import type { DocumentChangeSet } from './topology-edits';

/** What each removed junction flows into, following only the relations that carry flow. */
interface JunctionFlow {
	readonly junctions: ReadonlySet<string>;
	readonly targets: ReadonlyMap<string, readonly string[]>;
}

/** The endpoints a removed junction reaches past every removed junction chained after it. */
function reachedEndpoints(flow: JunctionFlow, junctionId: string): readonly string[] {
	const pending = [junctionId];
	const visited = new Set(pending);
	const reached: string[] = [];
	for (const junction of pending) {
		for (const target of flow.targets.get(junction) ?? []) {
			if (!flow.junctions.has(target)) reached.push(target);
			else if (!visited.has(target)) {
				visited.add(target);
				pending.push(target);
			}
		}
	}
	return reached;
}

/**
 * The relations that keep the flow through removed junctions: each surviving source of a removed
 * junction reaches its surviving targets, across chains of removed junctions. A relation the author
 * selected carries no flow, and a source already related to a target gains no repeat.
 */
function junctionBridges(
	document: LogicDocument,
	removed: ReadonlySet<string>,
	selectedRelationIds: ReadonlySet<string>,
	relationId: () => string,
): readonly LogicRelation[] {
	const junctions = new Set(
		document.junctions.filter(({ id }) => removed.has(id)).map(({ id }) => id),
	);
	const carried = document.relations.filter(({ id }) => !selectedRelationIds.has(id));
	const targets = new Map<string, string[]>();
	for (const { from, to } of carried) {
		if (!junctions.has(from)) continue;
		const list = targets.get(from) ?? [];
		list.push(to);
		targets.set(from, list);
	}
	const related = new Set(document.relations.map(({ from, to }) => JSON.stringify([from, to])));
	const bridges: LogicRelation[] = [];
	for (const { from, to } of carried) {
		if (removed.has(from) || !junctions.has(to)) continue;
		for (const target of reachedEndpoints({ junctions, targets }, to)) {
			const key = JSON.stringify([from, target]);
			if (removed.has(target) || related.has(key)) continue;
			related.add(key);
			bridges.push({ id: relationId(), from, to: target });
		}
	}
	return bridges;
}

/**
 * Remove selected endpoints, group descendants, and every incident relation atomically; the
 * surviving endpoints around a removed junction stay related.
 */
export function projectDeletion(
	document: LogicDocument,
	endpointIds: readonly string[],
	relationIds: readonly string[],
	relationId: () => string,
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
	const relationAdditions = junctionBridges(document, removed, new Set(relationIds), relationId);
	for (const relation of document.relations) {
		if (removed.has(relation.from) || removed.has(relation.to)) relations.add(relation.id);
	}
	return {
		nodeAdditions: [],
		relationAdditions,
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
