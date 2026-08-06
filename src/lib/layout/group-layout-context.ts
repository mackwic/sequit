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

function cacheGroupDepth(
	start: LogicGroup,
	groupsById: ReadonlyMap<string, LogicGroup>,
	depthById: Map<string, number>,
): void {
	const path: LogicGroup[] = [];
	const pathIds = new Set<string>();
	let current: LogicGroup | undefined = start;
	let depth = -1;
	while (current !== undefined) {
		const cached = depthById.get(current.id);
		if (cached !== undefined) {
			depth = cached;
			break;
		}
		if (pathIds.has(current.id)) throw new Error(`Group containment cycle at: ${current.id}`);
		pathIds.add(current.id);
		path.push(current);
		const parentId = current.groupId;
		if (parentId === undefined) {
			current = undefined;
			continue;
		}
		const parent = groupsById.get(parentId);
		if (!parent) throw new Error(`Missing group: ${parentId}`);
		current = parent;
	}
	for (let index = path.length - 1; index >= 0; index -= 1) {
		const group = path[index];
		if (!group) throw new Error(`Missing group depth path at: ${index}`);
		depth += 1;
		depthById.set(group.id, depth);
	}
}

export function groupsByDescendingDepth(
	groups: readonly LogicGroup[],
	groupsById: ReadonlyMap<string, LogicGroup>,
): readonly LogicGroup[] {
	const depthById = new Map<string, number>();
	for (const group of groups) cacheGroupDepth(group, groupsById, depthById);
	return [...groups].sort(
		(left, right) =>
			(depthById.get(right.id) ?? 0) - (depthById.get(left.id) ?? 0) ||
			left.id.localeCompare(right.id),
	);
}

function addGroupMember(
	membersByGroupId: Map<string, string[]>,
	groupId: string | undefined,
	memberId: string,
): void {
	if (groupId === undefined) return;
	const members = membersByGroupId.get(groupId);
	if (members) {
		members.push(memberId);
	} else {
		membersByGroupId.set(groupId, [memberId]);
	}
}

export function groupMemberIds(graph: LogicGraph): ReadonlyMap<string, readonly string[]> {
	const result = new Map<string, string[]>();
	for (const node of graph.document.nodes) addGroupMember(result, node.groupId, node.id);
	for (const junction of graph.document.junctions) {
		addGroupMember(result, junction.groupId, junction.id);
	}
	for (const group of graph.document.groups) addGroupMember(result, group.groupId, group.id);
	return result;
}
