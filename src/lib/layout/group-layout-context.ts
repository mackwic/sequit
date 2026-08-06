import type { LogicGroup } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';

function groupHierarchyKey(groupId: string, groupsById: ReadonlyMap<string, LogicGroup>): string {
	const path: string[] = [];
	const visited = new Set<string>();
	let current: string | undefined = groupId;
	while (current !== undefined) {
		if (visited.has(current)) throw new Error(`Group containment cycle at: ${current}`);
		visited.add(current);
		path.push(current);
		current = groupsById.get(current)?.groupId;
	}
	return path.reverse().join('/');
}

export function endpointLayoutContext(
	graph: LogicGraph,
	endpointId: string,
	groupsById: ReadonlyMap<string, LogicGroup>,
): string {
	const groupId = graph.endpointsById.get(endpointId)?.entity.groupId;
	if (groupId === undefined) return '~root';
	return groupHierarchyKey(groupId, groupsById);
}

export function componentContext(
	graph: LogicGraph,
	ids: readonly string[],
	groupsById: ReadonlyMap<string, LogicGroup>,
): string {
	const contexts = new Set<string>();
	for (const id of ids) contexts.add(endpointLayoutContext(graph, id, groupsById));
	return [...contexts].sort((left, right) => left.localeCompare(right)).join('|');
}

export function groupDepth(group: LogicGroup, groupsById: ReadonlyMap<string, LogicGroup>): number {
	let depth = 0;
	let parentId = group.groupId;
	const visited = new Set([group.id]);
	while (parentId !== undefined) {
		if (visited.has(parentId)) throw new Error(`Group containment cycle at: ${parentId}`);
		visited.add(parentId);
		depth += 1;
		parentId = groupsById.get(parentId)?.groupId;
	}
	return depth;
}
