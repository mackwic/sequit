import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, Point, RoutingLayers } from '../layout-types';
import {
	componentExteriorCandidates,
	type ExteriorCandidates,
	exteriorFor,
} from './component-passages';
import { commonGroupBounds, foreignGroupObstacles } from './group-passages';
import { byJogCrossings, type PassageReservation } from './passage-jogs';
import { prepareRouteObstacles, routeHitsObstacles, type RouteObstacles } from './route-obstacles';

interface PassageInput {
	readonly graph: LogicGraph;
	readonly layers: RoutingLayers;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly componentByEndpointId?: ReadonlyMap<string, number> | undefined;
	readonly sourceOffsets?: ReadonlyMap<string, number> | undefined;
	readonly targetOffsets?: ReadonlyMap<string, number> | undefined;
}

interface PassageWorkspace extends PassageInput {
	readonly ancestorCache: Map<string, readonly string[]>;
	readonly intervalCache: Map<string, readonly Interval[]>;
	readonly obstacles: Map<string, RouteObstacles | undefined>;
	readonly reservations: PassageReservation[];
	readonly groupObstacleCache: Map<string, RouteObstacles | undefined>;
	exteriorCandidates?: ReadonlyMap<number, ExteriorCandidates>;
}

interface Interval {
	readonly start: number;
	readonly end: number;
}

interface PassageSelection {
	readonly workspace: PassageWorkspace;
	readonly relation: LogicRelation;
	candidates: number[];
	readonly endpoints: readonly [source: Bounds, target: Bounds];
	readonly sourceCoordinate: number;
	readonly targetCoordinate: number;
	readonly group: Interval | undefined;
	readonly foreignGroupObstacles: RouteObstacles | undefined;
	readonly layerSpan: readonly [target: number, source: number];
}

function column(coordinate: number, box: Bounds, vertical: boolean): Point {
	if (vertical) return { x: coordinate, y: box.y + box.height / 2 };
	return { x: box.x + box.width / 2, y: coordinate };
}

/** Lower bound in the sorted reservation index; equal coordinates stay adjacent. */
function insertionIndex(reservations: readonly PassageReservation[], coordinate: number): number {
	let start = 0;
	let end = reservations.length;
	while (start < end) {
		const middle = Math.floor((start + end) / 2);
		if (defined(reservations[middle]).coordinate < coordinate) start = middle + 1;
		else end = middle;
	}
	return start;
}

function obstaclesAcross(
	input: PassageWorkspace,
	targetLayer: number,
	sourceLayer: number,
): RouteObstacles | undefined {
	const key = `${targetLayer}:${sourceLayer}`;
	const { obstacles } = input;
	if (obstacles.has(key)) return obstacles.get(key);
	const boxes: Bounds[] = [];
	for (let layer = targetLayer + 1; layer < sourceLayer; layer += 1)
		for (const id of defined(input.layers.rows[layer])) {
			if (input.graph.endpointsById.get(id)?.kind === EndpointKind.Group) continue;
			boxes.push(defined(input.bounds.get(id)));
		}
	let index: RouteObstacles | undefined;
	if (boxes.length > 0) index = prepareRouteObstacles(boxes, RAIL_SPACING);
	obstacles.set(key, index);
	return index;
}

function transverseInterval(box: Bounds, vertical: boolean): Interval {
	let origin = box.y;
	let size = box.height;
	if (vertical) {
		origin = box.x;
		size = box.width;
	}
	return { start: origin - RAIL_SPACING, end: origin + size + RAIL_SPACING };
}

function mergedIntervals(boxes: readonly Bounds[], vertical: boolean): readonly Interval[] {
	const sorted = boxes
		.map((box) => transverseInterval(box, vertical))
		.sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: Interval[] = [];
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

function sortByDistance(candidates: number[], source: number, target: number): readonly number[] {
	return candidates.sort((left, right) => {
		const leftCost = Math.abs(left - source) + Math.abs(left - target);
		const rightCost = Math.abs(right - source) + Math.abs(right - target);
		return leftCost - rightCost || left - right;
	});
}

/** Free transverse gaps between obstacle clusters, nearest to the two endpoint ports first. */
function internalCorridorCandidates(
	occupied: readonly Interval[],
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
	occupied: readonly Interval[],
	group: Interval,
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
function groupPaddingCandidates(
	selection: PassageSelection,
	occupied: readonly Interval[],
): readonly number[] {
	const { group, sourceCoordinate, targetCoordinate, workspace } = selection;
	if (group === undefined) return [];
	const preferred = (sourceCoordinate + targetCoordinate) / 2;
	const maximumTracks = workspace.reservations.length + 1;
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

function occupiedIntervals(
	input: PassageWorkspace,
	targetLayer: number,
	sourceLayer: number,
): readonly Interval[] {
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

function reservationIndex(selection: PassageSelection, coordinate: number): number | undefined {
	const { workspace, group } = selection;
	const [targetLayer, sourceLayer] = selection.layerSpan;
	if (group !== undefined) {
		if (coordinate < group.start || coordinate > group.end) return undefined;
	}
	const reservations = workspace.reservations;
	const index = insertionIndex(reservations, coordinate);
	for (let before = index - 1; before >= 0; before -= 1) {
		const held = defined(reservations[before]);
		if (coordinate - held.coordinate >= RAIL_SPACING) break;
		if (held.targetLayer < sourceLayer && targetLayer < held.sourceLayer) return undefined;
	}
	for (let after = index; after < reservations.length; after += 1) {
		const held = defined(reservations[after]);
		if (held.coordinate - coordinate >= RAIL_SPACING) break;
		if (held.targetLayer < sourceLayer && targetLayer < held.sourceLayer) return undefined;
	}
	return index;
}

function candidateHitsObstacles(
	selection: PassageSelection,
	candidate: number,
	obstacleIndex: RouteObstacles | undefined,
): boolean {
	const [source, target] = selection.endpoints;
	const points = [
		column(candidate, source, selection.workspace.vertical),
		column(candidate, target, selection.workspace.vertical),
	];
	if (obstacleIndex !== undefined) {
		if (routeHitsObstacles(points, obstacleIndex)) return true;
	}
	const foreignGroupObstacles = selection.foreignGroupObstacles;
	if (foreignGroupObstacles !== undefined) {
		if (routeHitsObstacles(points, foreignGroupObstacles)) return true;
	}
	return false;
}

function selectPassage(input: PassageSelection): number | undefined {
	const { workspace } = input;
	const [targetLayer, sourceLayer] = input.layerSpan;
	let obstacleIndex: RouteObstacles | undefined;
	let obstacleIndexReady = false;
	for (const candidate of byJogCrossings(workspace, input)) {
		const index = reservationIndex(input, candidate);
		if (index === undefined) continue;
		if (!obstacleIndexReady) {
			obstacleIndex = obstaclesAcross(workspace, targetLayer, sourceLayer);
			obstacleIndexReady = true;
		}
		if (candidateHitsObstacles(input, candidate, obstacleIndex)) continue;
		workspace.reservations.splice(index, 0, {
			coordinate: candidate,
			sourceLayer,
			targetLayer,
			sourceId: input.relation.from,
			targetId: input.relation.to,
			sourceCoordinate: input.sourceCoordinate,
			targetCoordinate: input.targetCoordinate,
		});
		return candidate;
	}
	return undefined;
}

function reservePassage(input: PassageWorkspace, relation: LogicRelation): number | undefined {
	const sourceLayer = defined(input.layers.byId.get(relation.from));
	const targetLayer = defined(input.layers.byId.get(relation.to));
	if (sourceLayer <= targetLayer + 1) return undefined;
	const source = defined(input.bounds.get(relation.from));
	const target = defined(input.bounds.get(relation.to));
	const sourceOffset = input.sourceOffsets?.get(relation.id) ?? 0;
	const targetOffset = input.targetOffsets?.get(relation.id) ?? 0;
	const sourceCoordinate = transverseCenter(source, input.vertical) + sourceOffset;
	const targetCoordinate = transverseCenter(target, input.vertical) + targetOffset;
	const group = commonGroupBounds(input, relation);
	const foreignGroups = foreignGroupObstacles(input, relation);
	let occupied = occupiedIntervals(input, targetLayer, sourceLayer);
	if (group !== undefined) {
		const scoped: Interval[] = [];
		for (const interval of occupied) {
			const start = Math.max(interval.start, group.start);
			const end = Math.min(interval.end, group.end);
			if (start <= end) scoped.push({ start, end });
		}
		occupied = scoped;
	}
	input.exteriorCandidates ??= componentExteriorCandidates(input);
	const exterior = exteriorFor(
		relation.from,
		input.componentByEndpointId,
		input.exteriorCandidates,
	);
	let preferred: readonly number[] = [];
	if (group === undefined) preferred = exterior.preferred;
	const fallback = exterior.fallback;
	const selection: PassageSelection = {
		workspace: input,
		relation,
		candidates: [],
		endpoints: [source, target],
		sourceCoordinate,
		targetCoordinate,
		group,
		foreignGroupObstacles: foreignGroups,
		layerSpan: [targetLayer, sourceLayer],
	};
	selection.candidates.push(sourceCoordinate, targetCoordinate);
	selection.candidates.push(...preferred);
	selection.candidates.push(
		...internalCorridorCandidates(occupied, sourceCoordinate, targetCoordinate),
	);
	selection.candidates.push(...groupPaddingCandidates(selection, occupied));
	if (group !== undefined) selection.candidates.push(...exterior.preferred);
	selection.candidates.push(...fallback);
	return selectPassage(selection);
}

/** A new allocator belongs to one geometry phase; nothing survives the next placement. */
export function layerPassages(
	input: PassageInput,
): (relation: LogicRelation) => number | undefined {
	const workspace: PassageWorkspace = {
		...input,
		ancestorCache: new Map(),
		intervalCache: new Map(),
		obstacles: new Map(),
		reservations: [],
		groupObstacleCache: new Map(),
	};
	return (relation) => reservePassage(workspace, relation);
}
