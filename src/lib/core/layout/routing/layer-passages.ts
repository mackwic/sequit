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
	readonly obstacles: Map<number, RouteObstacles | undefined>;
	readonly reservations: PassageReservation[];
	readonly groupObstacleCache: Map<string, RouteObstacles | undefined>;
	exteriorCandidates?: ReadonlyMap<number, ExteriorCandidates>;
}

interface Interval {
	readonly start: number;
	readonly end: number;
}

interface PassageReservation {
	readonly coordinate: number;
	readonly sourceLayer: number;
	readonly targetLayer: number;
}

interface PassageSelection {
	readonly workspace: PassageWorkspace;
	readonly candidates: readonly number[];
	readonly crossed: readonly RouteObstacles[];
	readonly endpoints: readonly [source: Bounds, target: Bounds];
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

function obstaclesIn(input: PassageWorkspace, layer: number): RouteObstacles | undefined {
	const { obstacles } = input;
	if (!obstacles.has(layer)) {
		const row = defined(input.layers.rows[layer]);
		let index: RouteObstacles | undefined;
		if (row.length > 0)
			index = prepareRouteObstacles(
				row.map((id) => defined(input.bounds.get(id))),
				RAIL_SPACING,
			);
		obstacles.set(layer, index);
	}
	return obstacles.get(layer);
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

/** The containing group's leading and trailing padding remain fallbacks after internal gaps. */
function groupPaddingCandidates(
	occupied: readonly Interval[],
	group: Interval | undefined,
	source: number,
	target: number,
): readonly number[] {
	if (group === undefined || occupied.length === 0) return [];
	const preferred = (source + target) / 2;
	const first = defined(occupied[0]);
	const last = defined(occupied.at(-1));
	const candidates = [
		Math.max(group.start, Math.min(preferred, first.start)),
		Math.max(last.end, Math.min(preferred, group.end)),
	];
	return sortByDistance(candidates, source, target);
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
		for (const id of defined(input.layers.rows[layer])) boxes.push(defined(input.bounds.get(id)));
	const intervals = mergedIntervals(boxes, input.vertical);
	input.intervalCache.set(key, intervals);
	return intervals;
}

function reserveCoordinate(
	input: PassageWorkspace,
	coordinate: number,
	targetLayer: number,
	sourceLayer: number,
): boolean {
	const reservations = input.reservations;
	const index = insertionIndex(reservations, coordinate);
	for (let before = index - 1; before >= 0; before -= 1) {
		const held = defined(reservations[before]);
		if (coordinate - held.coordinate >= RAIL_SPACING) break;
		if (held.targetLayer < sourceLayer && targetLayer < held.sourceLayer) return false;
	}
	for (let after = index; after < reservations.length; after += 1) {
		const held = defined(reservations[after]);
		if (held.coordinate - coordinate >= RAIL_SPACING) break;
		if (held.targetLayer < sourceLayer && targetLayer < held.sourceLayer) return false;
	}
	reservations.splice(index, 0, { coordinate, sourceLayer, targetLayer });
	return true;
}

function selectPassage(input: PassageSelection): number | undefined {
	const { workspace, candidates, crossed, group } = input;
	const [source, target] = input.endpoints;
	const [targetLayer, sourceLayer] = input.layerSpan;
	for (const candidate of new Set(candidates)) {
		let insideGroup = true;
		if (group !== undefined) {
			const afterStart = candidate >= group.start;
			const beforeEnd = candidate <= group.end;
			insideGroup = afterStart && beforeEnd;
		}
		if (!insideGroup) continue;
		const points = [
			column(candidate, source, workspace.vertical),
			column(candidate, target, workspace.vertical),
		];
		if (crossed.some((index) => routeHitsObstacles(points, index))) continue;
		if (
			input.foreignGroupObstacles !== undefined &&
			routeHitsObstacles(points, input.foreignGroupObstacles)
		)
			continue;
		if (!reserveCoordinate(workspace, candidate, targetLayer, sourceLayer)) continue;
		return candidate;
	}
	return undefined;
}

function reservePassage(input: PassageWorkspace, relation: LogicRelation): number | undefined {
	if (input.graph.endpointsById.get(relation.from)?.kind !== EndpointKind.Node) return undefined;
	if (input.graph.endpointsById.get(relation.to)?.kind !== EndpointKind.Node) return undefined;
	const sourceLayer = defined(input.layers.byId.get(relation.from));
	const targetLayer = defined(input.layers.byId.get(relation.to));
	if (sourceLayer <= targetLayer + 1) return undefined;
	const crossed: RouteObstacles[] = [];
	for (let layer = targetLayer + 1; layer < sourceLayer; layer += 1) {
		const index = obstaclesIn(input, layer);
		if (index !== undefined) crossed.push(index);
	}
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
	let fallback: readonly number[] = [];
	if (group === undefined) {
		preferred = exterior.preferred;
		fallback = exterior.fallback;
	}
	const candidates = [
		...preferred,
		sourceCoordinate,
		targetCoordinate,
		...internalCorridorCandidates(occupied, sourceCoordinate, targetCoordinate),
		...groupPaddingCandidates(occupied, group, sourceCoordinate, targetCoordinate),
		...fallback,
	];
	return selectPassage({
		workspace: input,
		candidates,
		crossed,
		endpoints: [source, target],
		group,
		foreignGroupObstacles: foreignGroups,
		layerSpan: [targetLayer, sourceLayer],
	});
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
