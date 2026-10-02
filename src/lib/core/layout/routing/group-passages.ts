import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { mainSize, transverseSize, transverseStart } from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, Point, RoutingLayers } from '../layout-types';
import { freeOfGroupShells, type MainInterval } from './group-shells';
import { prepareRouteObstacles, type RouteObstacles } from './route-obstacles';

export interface GroupPassageContext {
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

interface JogCorridor extends GroupInterval {
	readonly row: readonly string[];
}

interface PassageObstacles {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly layers: RoutingLayers;
	readonly vertical: boolean;
	readonly intervalCache: Map<string, readonly GroupInterval[]>;
	readonly obstacles: Map<string, RouteObstacles | undefined>;
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
	if (input.vertical) return { start: bounds.x, end: bounds.x + bounds.width };
	return { start: bounds.y, end: bounds.y + bounds.height };
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

function physicalMain(box: Bounds, vertical: boolean): MainInterval {
	let start = box.x;
	if (vertical) start = box.y;
	return { start, end: start + mainSize(box, vertical) };
}

function jogRail(
	input: GroupPassageContext & { readonly layers: RoutingLayers },
	endpoint: Bounds,
	other: Bounds,
	corridor: JogCorridor,
): number {
	const own = physicalMain(endpoint, input.vertical);
	let neighbour: MainInterval | undefined;
	for (const id of corridor.row) {
		if (input.graph.endpointsById.get(id)?.kind === EndpointKind.Group) continue;
		const next = physicalMain(defined(input.bounds.get(id)), input.vertical);
		if (neighbour === undefined) neighbour = next;
		else
			neighbour = {
				start: Math.min(neighbour.start, next.start),
				end: Math.max(neighbour.end, next.end),
			};
	}
	neighbour ??= physicalMain(other, input.vertical);
	let gap = { start: neighbour.end, end: own.start };
	if (own.start < neighbour.start) gap = { start: own.end, end: neighbour.start };
	const frames: MainInterval[] = [];
	for (const { id } of input.graph.document.groups) {
		const box = input.bounds.get(id);
		if (box === undefined) continue;
		const start = transverseStart(box, input.vertical);
		const end = start + transverseSize(box, input.vertical);
		if (start > corridor.end || end < corridor.start) continue;
		frames.push(physicalMain(box, input.vertical));
	}
	const free = defined(freeOfGroupShells([gap], frames)[0]);
	return (free.start + free.end) / 2;
}

/** Check the two channel jogs as well as the longitudinal passage, in the current geometry. */
export function passageGroupPoints(
	input: GroupPassageContext & { readonly layers: RoutingLayers },
	relation: LogicRelation,
	coordinates: { readonly source: number; readonly target: number; readonly passage: number },
): readonly Point[] {
	const source = defined(input.bounds.get(relation.from));
	const target = defined(input.bounds.get(relation.to));
	const sourceLayer = defined(input.layers.byId.get(relation.from));
	const targetLayer = defined(input.layers.byId.get(relation.to));
	const sourceCorridor = {
		start: Math.min(coordinates.source, coordinates.passage),
		end: Math.max(coordinates.source, coordinates.passage),
		row: defined(input.layers.rows[sourceLayer - 1]),
	};
	const targetCorridor = {
		start: Math.min(coordinates.target, coordinates.passage),
		end: Math.max(coordinates.target, coordinates.passage),
		row: defined(input.layers.rows[targetLayer + 1]),
	};
	const sourceRail = jogRail(input, source, target, sourceCorridor);
	const targetRail = jogRail(input, target, source, targetCorridor);
	if (input.vertical)
		return [
			{ x: coordinates.source, y: sourceRail },
			{ x: coordinates.passage, y: sourceRail },
			{ x: coordinates.passage, y: targetRail },
			{ x: coordinates.target, y: targetRail },
		];
	return [
		{ x: sourceRail, y: coordinates.source },
		{ x: sourceRail, y: coordinates.passage },
		{ x: targetRail, y: coordinates.passage },
		{ x: targetRail, y: coordinates.target },
	];
}

interface GroupPaddingSelection {
	readonly group: GroupInterval | undefined;
	readonly sourceCoordinate: number;
	readonly targetCoordinate: number;
}

function sortByDistance(candidates: number[], source: number, target: number): readonly number[] {
	return candidates.sort((left, right) => {
		const leftCost = Math.abs(left - source) + Math.abs(left - target);
		const rightCost = Math.abs(right - source) + Math.abs(right - target);
		return leftCost - rightCost || left - right;
	});
}

/** Free transverse gaps between obstacle clusters, nearest to the two endpoint ports first. */
export function internalCorridorCandidates(
	occupied: readonly GroupInterval[],
	source: number,
	target: number,
): readonly number[] {
	const preferred = (source + target) / 2;
	const candidates: number[] = [];
	for (let index = 1; index < occupied.length; index += 1) {
		const before = defined(occupied[index - 1]);
		const after = defined(occupied[index]);
		candidates.push(Math.max(before.end, Math.min(preferred, after.start)));
	}
	return sortByDistance(candidates, source, target);
}

function occupiedGroupPaddingCandidates(
	occupied: readonly GroupInterval[],
	group: GroupInterval,
	preferred: number,
	maximumTracks: number,
): number[] {
	const first = defined(occupied[0]);
	const last = defined(occupied.at(-1));
	const leading = Math.max(group.start, Math.min(preferred, first.start));
	const trailing = Math.max(last.end, Math.min(preferred, group.end));
	const candidates = [leading, trailing];
	for (let track = 1; track < maximumTracks; track += 1) {
		const candidate = leading - track * RAIL_SPACING;
		if (candidate < group.start) break;
		candidates.push(candidate);
	}
	for (let track = 1; track < maximumTracks; track += 1) {
		const candidate = trailing + track * RAIL_SPACING;
		if (candidate > group.end) break;
		candidates.push(candidate);
	}
	return candidates;
}

/** Reuse 24px-spaced free tracks in the containing frame after internal gaps. */
export function groupPaddingCandidates(
	selection: GroupPaddingSelection,
	occupied: readonly GroupInterval[],
	maximumTracks: number,
): readonly number[] {
	const { group, sourceCoordinate, targetCoordinate } = selection;
	if (group === undefined) return [];
	const preferred = (sourceCoordinate + targetCoordinate) / 2;
	let candidates: number[];
	if (occupied.length === 0) {
		candidates = [];
		for (let track = 1; track <= maximumTracks; track += 1) {
			const leading = preferred - track * RAIL_SPACING;
			const trailing = preferred + track * RAIL_SPACING;
			if (leading < group.start && trailing > group.end) break;
			if (leading >= group.start) candidates.push(leading);
			if (trailing <= group.end) candidates.push(trailing);
		}
	} else {
		candidates = occupiedGroupPaddingCandidates(occupied, group, preferred, maximumTracks);
	}
	return sortByDistance(candidates, sourceCoordinate, targetCoordinate);
}

export function obstaclesAcross(
	input: PassageObstacles,
	targetLayer: number,
	sourceLayer: number,
	clearance: number,
): RouteObstacles | undefined {
	const key = `${targetLayer}:${sourceLayer}:${clearance}`;
	const { obstacles } = input;
	if (obstacles.has(key)) return obstacles.get(key);
	const boxes: Bounds[] = [];
	for (let layer = targetLayer + 1; layer < sourceLayer; layer += 1)
		for (const id of defined(input.layers.rows[layer])) {
			if (input.graph.endpointsById.get(id)?.kind === EndpointKind.Group) continue;
			boxes.push(defined(input.bounds.get(id)));
		}
	let index: RouteObstacles | undefined;
	if (boxes.length > 0) index = prepareRouteObstacles(boxes, clearance);
	obstacles.set(key, index);
	return index;
}

function transverseInterval(box: Bounds, vertical: boolean): GroupInterval {
	let origin = box.y;
	let size = box.height;
	if (vertical) {
		origin = box.x;
		size = box.width;
	}
	return { start: origin - RAIL_SPACING, end: origin + size + RAIL_SPACING };
}

function mergedIntervals(boxes: readonly Bounds[], vertical: boolean): readonly GroupInterval[] {
	const sorted = boxes
		.map((box) => transverseInterval(box, vertical))
		.sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: GroupInterval[] = [];
	for (const interval of sorted) {
		const previous = merged.at(-1);
		if (previous === undefined || interval.start >= previous.end) {
			merged.push(interval);
			continue;
		}
		if (interval.end > previous.end)
			merged[merged.length - 1] = { start: previous.start, end: interval.end };
	}
	return merged;
}

export function occupiedIntervals(
	input: PassageObstacles,
	targetLayer: number,
	sourceLayer: number,
): readonly GroupInterval[] {
	const key = `${targetLayer}:${sourceLayer}`;
	const cached = input.intervalCache.get(key);
	if (cached !== undefined) return cached;
	const boxes: Bounds[] = [];
	for (let layer = targetLayer + 1; layer < sourceLayer; layer += 1)
		for (const id of defined(input.layers.rows[layer]))
			if (input.graph.endpointsById.get(id)?.kind !== EndpointKind.Group)
				boxes.push(defined(input.bounds.get(id)));
	const intervals = mergedIntervals(boxes, input.vertical);
	input.intervalCache.set(key, intervals);
	return intervals;
}
