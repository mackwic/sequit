import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { GROUP_SHELL_CLEARANCE, RAIL_SPACING } from '../layout-settings';
import { type Bounds, GroupRouteFailure, type Point, type RoutingLayers } from '../layout-types';
import {
	componentExteriorCandidates,
	type ExteriorCandidates,
	exteriorFor,
} from './component-passages';
import {
	commonGroupBounds,
	foreignGroupObstacles,
	groupPaddingCandidates,
	internalCorridorCandidates,
	passageGroupPoints,
} from './group-passages';
import {
	packedShellCandidates,
	parallelShellObstacles,
	parallelShells,
	shellPassageCandidates,
} from './group-shells';
import { freeColumnIndex, holdOuterColumn, passageEnds } from './passage-columns';
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
	readonly shellObstacles: RouteObstacles;
	readonly shellCandidates: readonly number[];
	readonly sharedClearance: number;
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

function obstaclesAcross(
	input: PassageWorkspace,
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
	if (routeHitsObstacles(points, selection.workspace.shellObstacles)) return true;
	if (obstacleIndex !== undefined) {
		if (routeHitsObstacles(points, obstacleIndex)) return true;
	}
	const foreignGroupObstacles = selection.foreignGroupObstacles;
	if (foreignGroupObstacles !== undefined) {
		const jogs = passageGroupPoints(selection.workspace, selection.relation, {
			source: selection.sourceCoordinate,
			target: selection.targetCoordinate,
			passage: candidate,
		});
		if (routeHitsObstacles(jogs, foreignGroupObstacles)) return true;
	}
	return false;
}

/** Keep the former admissible column as a geometric tie-break, without relaxing shell checks. */
function previousPassage(input: PassageSelection, ordered: readonly number[]): number | undefined {
	const { workspace, group } = input;
	const [targetLayer, sourceLayer] = input.layerSpan;
	const ordinary = obstaclesAcross(workspace, targetLayer, sourceLayer, RAIL_SPACING);
	const foreign = foreignGroupObstacles(workspace, input.relation);
	for (const candidate of ordered) {
		if (group !== undefined) {
			if (candidate < group.start || candidate > group.end) continue;
		}
		if (freeColumnIndex(workspace.reservations, input.layerSpan, candidate) === undefined) continue;
		const points = input.endpoints.map((box) => column(candidate, box, workspace.vertical));
		if (ordinary !== undefined && routeHitsObstacles(points, ordinary)) continue;
		if (foreign !== undefined && routeHitsObstacles(points, foreign)) continue;
		return candidate;
	}
	return undefined;
}

function selectPassage(
	input: PassageSelection,
	clearance = RAIL_SPACING,
	spacing = RAIL_SPACING,
): number | undefined {
	const { workspace } = input;
	const [targetLayer, sourceLayer] = input.layerSpan;
	let obstacleIndex: RouteObstacles | undefined;
	let obstacleIndexReady = false;
	const ordered = byJogCrossings(workspace, input);
	const preferred = previousPassage(input, ordered);
	const candidates = [...ordered, ...workspace.shellCandidates];
	if (preferred !== undefined) {
		const anchor = preferred;
		candidates.sort((left, right) => Math.abs(left - anchor) - Math.abs(right - anchor));
	}
	for (const candidate of byJogCrossings(workspace, { ...input, candidates })) {
		const { group } = input;
		if (group !== undefined) {
			if (candidate < group.start || candidate > group.end) continue;
		}
		const index = freeColumnIndex(workspace.reservations, input.layerSpan, candidate, spacing);
		if (index === undefined) continue;
		if (!obstacleIndexReady) {
			obstacleIndex = obstaclesAcross(workspace, targetLayer, sourceLayer, clearance);
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

function appendPackedCandidates(selection: PassageSelection): void {
	const { workspace: input } = selection;
	const [targetLayer, sourceLayer] = selection.layerSpan;
	const boxes: Bounds[] = [];
	for (let layer = targetLayer + 1; layer < sourceLayer; layer += 1)
		for (const id of defined(input.layers.rows[layer]))
			if (input.graph.endpointsById.get(id)?.kind !== EndpointKind.Group)
				boxes.push(defined(input.bounds.get(id)));
	const edges = [
		...input.shellCandidates,
		...input.reservations.map(({ coordinate }) => coordinate),
	];
	selection.candidates.push(...packedShellCandidates(boxes, input.vertical, edges));
}

function reservePassage(
	input: PassageWorkspace,
	relation: LogicRelation,
	spacing = RAIL_SPACING,
): number | undefined {
	const { layerSpan, sourceCoordinate, targetCoordinate } = passageEnds(input, relation);
	const [targetLayer, sourceLayer] = layerSpan;
	if (sourceLayer <= targetLayer + 1) return undefined;
	const source = defined(input.bounds.get(relation.from));
	const target = defined(input.bounds.get(relation.to));
	const group = commonGroupBounds(input, relation);
	const foreignGroups = foreignGroupObstacles(input, relation, 0);
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
		layerSpan,
	};
	selection.candidates.push(sourceCoordinate, targetCoordinate);
	selection.candidates.push(...preferred);
	selection.candidates.push(
		...internalCorridorCandidates(occupied, sourceCoordinate, targetCoordinate),
	);
	selection.candidates.push(
		...groupPaddingCandidates(selection, occupied, input.reservations.length + 1),
	);
	if (group !== undefined) selection.candidates.push(...exterior.preferred);
	if (spacing < RAIL_SPACING) appendPackedCandidates(selection);
	selection.candidates.push(...fallback);
	const passage = selectPassage(selection, RAIL_SPACING, spacing);
	if (passage !== undefined || group === undefined) return passage;
	// If no full-clearance column fits, share the padding between the node and its frame.
	const shared = selectPassage(selection, input.sharedClearance, spacing);
	if (shared !== undefined || spacing === RAIL_SPACING) return shared;
	return selectPassage(selection, 0, spacing);
}

/** An outer column held like the other passages, so that no later passage runs along it. */
function reserveOuterColumn(
	input: PassageWorkspace,
	relation: LogicRelation,
	start: number,
): number {
	if (commonGroupBounds(input, relation) !== undefined) {
		let spacing = RAIL_SPACING / (input.reservations.length + 1);
		let passage = reservePassage(input, relation, spacing);
		while (passage === undefined && spacing > Number.EPSILON) {
			spacing /= 2;
			passage = reservePassage(input, relation, spacing);
		}
		if (passage === undefined) throw new GroupRouteFailure(relation.id);
		return passage;
	}
	return holdOuterColumn(input.reservations, relation, passageEnds(input, relation), start);
}

/** A straight, internal or exterior passage, or undefined when none is free. */
export interface LayerPassageAllocator {
	(relation: LogicRelation): number | undefined;
	readonly outer: (relation: LogicRelation, start: number) => number;
}

/** A new allocator belongs to one geometry phase; nothing survives the next placement. */
export function layerPassages(input: PassageInput): LayerPassageAllocator {
	const shells = parallelShells(input.graph, input.bounds, input.vertical);
	let sharedClearance = GROUP_SHELL_CLEARANCE;
	for (const { leading, trailing } of shells)
		sharedClearance = Math.min(sharedClearance, leading, trailing);
	const workspace: PassageWorkspace = {
		...input,
		ancestorCache: new Map(),
		intervalCache: new Map(),
		obstacles: new Map(),
		reservations: [],
		groupObstacleCache: new Map(),
		shellObstacles: parallelShellObstacles(shells, input.vertical),
		shellCandidates: shellPassageCandidates(shells),
		sharedClearance,
	};
	return Object.assign((relation: LogicRelation) => reservePassage(workspace, relation), {
		outer: (relation: LogicRelation, start: number) =>
			reserveOuterColumn(workspace, relation, start),
	});
}
