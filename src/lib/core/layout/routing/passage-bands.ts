import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import { mainSize, transverseSize, transverseStart } from '../geometry/layout-frame';
import { GROUP_SHELL_CLEARANCE, MIN_PASSAGE_SPACING } from '../layout-settings';
import type { Bounds, RoutingLayers } from '../layout-types';
import {
	foreignGroupObstacles,
	type GroupPassageContext,
	passageGroupPoints,
} from './group-passages';
import { type PassageEnds, passageEnds } from './passage-columns';
import { prepareRouteObstacles, routeHitsObstacles } from './route-obstacles';

interface BandContext extends GroupPassageContext {
	readonly layers: RoutingLayers;
	readonly sourceOffsets?: ReadonlyMap<string, number> | undefined;
	readonly targetOffsets?: ReadonlyMap<string, number> | undefined;
}

interface Band {
	readonly start: number;
	readonly end: number;
	first: number;
	last: number;
}

interface Passage {
	readonly relation: LogicRelation;
	readonly coordinate: number;
	readonly first: number;
	readonly last: number;
}

function mainInterval(box: Bounds, vertical: boolean): readonly [number, number] {
	let first = box.x;
	if (vertical) first = box.y;
	return [first, first + mainSize(box, vertical)];
}

function bandAround(input: BandContext, passage: Passage, first: number, last: number): Band {
	let start = Number.NEGATIVE_INFINITY;
	let end = Number.POSITIVE_INFINITY;
	for (const [id, box] of input.bounds) {
		const [near, far] = mainInterval(box, input.vertical);
		if (near >= last || far <= first) continue;
		const leading = transverseStart(box, input.vertical);
		const trailing = leading + transverseSize(box, input.vertical);
		const insideNode = input.graph.endpointsById.get(id)?.kind !== EndpointKind.Group;
		const contains = leading < passage.coordinate && passage.coordinate < trailing;
		if (insideNode && contains) continue;
		if (trailing <= passage.coordinate) start = Math.max(start, trailing);
		else if (leading <= passage.coordinate) start = Math.max(start, leading);
		if (leading >= passage.coordinate) end = Math.min(end, leading);
		else if (trailing >= passage.coordinate) end = Math.min(end, trailing);
	}
	return { start, end, first, last };
}

function nearShellBand(input: BandContext, passage: Passage): Band | undefined {
	let result: Band | undefined;
	for (const { id } of input.graph.document.groups) {
		const box = input.bounds.get(id);
		if (box === undefined) continue;
		const [near, far] = mainInterval(box, input.vertical);
		const first = Math.max(near, passage.first);
		const last = Math.min(far, passage.last);
		if (first >= last) continue;
		const start = transverseStart(box, input.vertical);
		const end = start + transverseSize(box, input.vertical);
		const distance = Math.min(
			Math.abs(passage.coordinate - start),
			Math.abs(passage.coordinate - end),
		);
		if (distance === 0 || distance >= GROUP_SHELL_CLEARANCE) continue;
		const band = bandAround(input, passage, first, last);
		if (!Number.isFinite(band.start) || !Number.isFinite(band.end)) continue;
		let previousWidth = Number.POSITIVE_INFINITY;
		if (result !== undefined) previousWidth = result.end - result.start;
		if (band.end - band.start < previousWidth) result = band;
	}
	return result;
}

function preparedPassages(
	input: BandContext,
	passages: ReadonlyMap<LogicRelation, number>,
): Passage[] {
	const result: Passage[] = [];
	for (const [relation, coordinate] of passages) {
		const ends = passageEnds(input, relation);
		const points = passageGroupPoints(input, relation, {
			source: ends.sourceCoordinate,
			target: ends.targetCoordinate,
			passage: coordinate,
		});
		let first = defined(points[1]).x;
		let last = defined(points[2]).x;
		if (input.vertical) {
			first = defined(points[1]).y;
			last = defined(points[2]).y;
		}
		result.push({
			relation,
			coordinate,
			first: Math.min(first, last),
			last: Math.max(first, last),
		});
	}
	return result;
}

function portTooClose(
	ends: PassageEnds,
	[target, source]: readonly [number, number],
	coordinate: number,
): boolean {
	const [otherTarget, otherSource] = ends.layerSpan;
	if (otherSource > target && otherSource <= source) {
		const distance = Math.abs(coordinate - ends.sourceCoordinate);
		if (distance > 0 && distance < MIN_PASSAGE_SPACING) return true;
	}
	if (otherTarget >= target && otherTarget < source) {
		const distance = Math.abs(coordinate - ends.targetCoordinate);
		if (distance > 0 && distance < MIN_PASSAGE_SPACING) return true;
	}
	return false;
}

/** Port risers can overlap a passage when rails in their shared endpoint channel are staggered. */
export function readablePortPitch(
	input: BandContext,
	relation: LogicRelation,
	coordinate: number,
): boolean {
	if (input.graph.document.groups.length === 0) return true;
	const span = passageEnds(input, relation).layerSpan;
	for (const { relation: other } of input.graph.relations) {
		if (other.id === relation.id) continue;
		if (!input.layers.byId.has(other.from) || !input.layers.byId.has(other.to)) continue;
		if (!input.bounds.has(other.from) || !input.bounds.has(other.to)) continue;
		const ends = passageEnds(input, other);
		if (portTooClose(ends, span, coordinate)) return false;
	}
	return true;
}

function safePosition(input: BandContext, passage: Passage, coordinate: number): boolean {
	const obstacles = foreignGroupObstacles(input, passage.relation, 0);
	if (!readablePortPitch(input, passage.relation, coordinate)) return false;
	const ends = passageEnds(input, passage.relation);
	const points = passageGroupPoints(input, passage.relation, {
		source: ends.sourceCoordinate,
		target: ends.targetCoordinate,
		passage: coordinate,
	});
	if (obstacles !== undefined && routeHitsObstacles(points, obstacles)) return false;
	const nodes: Bounds[] = [];
	for (const [id, box] of input.bounds) {
		if (id === passage.relation.from || id === passage.relation.to) continue;
		if (input.graph.endpointsById.get(id)?.kind !== EndpointKind.Group) nodes.push(box);
	}
	return !routeHitsObstacles(points, prepareRouteObstacles(nodes, 0));
}

function packedBandPositions(
	input: BandContext,
	band: Band,
	members: readonly Passage[],
): ReadonlyMap<LogicRelation, number> | undefined {
	const columns = [...new Set(members.map(({ coordinate }) => coordinate))].sort(
		(left, right) => left - right,
	);
	const pitch = (band.end - band.start) / (columns.length + 1);
	if (columns.length > 1 && pitch < MIN_PASSAGE_SPACING) return undefined;
	const proposed = new Map<LogicRelation, number>();
	for (const member of members) {
		const index = columns.indexOf(member.coordinate);
		let coordinate = band.start + pitch * (index + 1);
		if (pitch >= GROUP_SHELL_CLEARANCE) {
			const lower = band.start + GROUP_SHELL_CLEARANCE + index * MIN_PASSAGE_SPACING;
			const remaining = columns.length - index - 1;
			const upper = band.end - GROUP_SHELL_CLEARANCE - remaining * MIN_PASSAGE_SPACING;
			coordinate = Math.max(lower, Math.min(member.coordinate, upper));
		}
		proposed.set(member.relation, coordinate);
	}
	if (
		members.some((member) => !safePosition(input, member, defined(proposed.get(member.relation))))
	)
		return undefined;
	return proposed;
}

/** Final route columns, not provisional reservations, share each narrow strip uniformly. */
export function finishPassageBands(
	input: BandContext,
	passages: ReadonlyMap<LogicRelation, number>,
): ReadonlyMap<LogicRelation, number> {
	if (input.graph.document.groups.length === 0) return passages;
	const prepared = preparedPassages(input, passages);
	const bands = new Map<string, Band>();
	for (const passage of prepared) {
		const band = nearShellBand(input, passage);
		if (band === undefined) continue;
		const key = `${band.start}:${band.end}`;
		const held = bands.get(key);
		if (held === undefined) bands.set(key, band);
		else {
			held.first = Math.min(held.first, band.first);
			held.last = Math.max(held.last, band.last);
		}
	}
	if (bands.size === 0) return passages;
	const result = new Map(passages);
	for (const band of bands.values()) {
		const members = prepared.filter(({ coordinate, first, last }) => {
			const inside = coordinate > band.start && coordinate < band.end;
			// Ranked access rails can extend either column across their shared channel midpoint.
			const overlaps = first <= band.last && last >= band.first;
			return inside && overlaps;
		});
		const proposed = packedBandPositions(input, band, members);
		if (proposed === undefined) continue;
		for (const [relation, coordinate] of proposed) result.set(relation, coordinate);
	}
	return result;
}
