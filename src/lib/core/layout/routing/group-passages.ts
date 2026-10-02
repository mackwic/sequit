import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { GROUP_SHELL_CLEARANCE, RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { prepareRouteObstacles, type RouteObstacles } from './route-obstacles';

interface GroupPassageContext {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly ancestorCache: Map<string, readonly string[]>;
	readonly groupObstacleCache: Map<string, RouteObstacles | undefined>;
}

interface GroupInterval {
	readonly start: number;
	readonly end: number;
}

function groupAncestors(input: GroupPassageContext, endpointId: string): readonly string[] {
	const cached = input.ancestorCache.get(endpointId);
	if (cached !== undefined) return cached;
	const result: string[] = [];
	if (input.graph.endpointsById.get(endpointId)?.kind === EndpointKind.Group)
		result.push(endpointId);
	let groupId = input.graph.endpointsById.get(endpointId)?.entity.groupId;
	while (groupId !== undefined) {
		result.push(groupId);
		groupId = input.graph.endpointsById.get(groupId)?.entity.groupId;
	}
	input.ancestorCache.set(endpointId, result);
	return result;
}

export function commonGroupBounds(
	input: GroupPassageContext,
	relation: LogicRelation,
): GroupInterval | undefined {
	const targetGroups = new Set(groupAncestors(input, relation.to));
	const groupId = groupAncestors(input, relation.from).find((id) => targetGroups.has(id));
	if (groupId === undefined) return undefined;
	const bounds = defined(input.bounds.get(groupId));
	if (input.vertical)
		return {
			start: bounds.x + GROUP_SHELL_CLEARANCE,
			end: bounds.x + bounds.width - GROUP_SHELL_CLEARANCE,
		};
	return {
		start: bounds.y + GROUP_SHELL_CLEARANCE,
		end: bounds.y + bounds.height - GROUP_SHELL_CLEARANCE,
	};
}

/** Ancestor frames belong to the route; all other group frames block it. */
export function foreignGroupObstacles(
	input: GroupPassageContext,
	relation: LogicRelation,
	clearance = RAIL_SPACING,
): RouteObstacles | undefined {
	const groups = input.graph.document.groups;
	if (groups.length === 0) return undefined;
	const owned = new Set([
		...groupAncestors(input, relation.from),
		...groupAncestors(input, relation.to),
	]);
	const key = `${clearance}:${JSON.stringify([...owned].sort())}`;
	if (input.groupObstacleCache.has(key)) return input.groupObstacleCache.get(key);
	const boxes: Bounds[] = [];
	for (const candidate of groups) {
		if (owned.has(candidate.id)) continue;
		const box = input.bounds.get(candidate.id);
		if (box !== undefined) boxes.push(box);
	}
	let index: RouteObstacles | undefined;
	if (boxes.length > 0) index = prepareRouteObstacles(boxes, clearance);
	input.groupObstacleCache.set(key, index);
	return index;
}
