import { defined, LaneOrientation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { RouteWorkCharge } from '../bridges/route-runs';
import {
	cross,
	crossEnd,
	crossStart,
	finiteOrthogonalSegment,
	hitsBox,
	inside,
	longEnd,
	longitudinal,
	longStart,
	segmentsSelfContact,
} from '../geometry/shared-lane-geometry-primitives';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import type { Bounds, LayoutElement, LayoutRelation, Point } from '../layout-types';
import { type LaneSide, laneSide, reverseDirection, verticalDirection } from './shared-lane-model';
import { validateSharedLaneRouteContacts } from './shared-lane-route-contact-validation';
import type { SharedLaneGeometry } from './shared-lane-types';
import { physicalTransverseSide, transverseRouteSides } from './shared-transverse-sides';

interface RouteGeometryContext {
	readonly geometry: SharedLaneGeometry;
	readonly boxes: ReadonlyMap<string, LayoutElement>;
	readonly clearance: number;
	readonly charge?: RouteWorkCharge | undefined;
}

interface RouteContext extends RouteGeometryContext {
	readonly orientation: LaneOrientation;
	readonly vertical: boolean;
	readonly reverse: boolean;
	readonly ports: Map<string, number[]>;
}

function attached(point: Point, bounds: Bounds, vertical: boolean, side: LaneSide): boolean {
	let expected = crossStart(bounds, vertical);
	if (side === 1) expected = crossEnd(bounds, vertical);
	const port = longitudinal(point, vertical);
	const within = port >= longStart(bounds, vertical) + PORT_INSET;
	const beforeEnd = port <= longEnd(bounds, vertical) - PORT_INSET;
	return cross(point, vertical) === expected && within && beforeEnd;
}

function portDirection(start: Point, next: Point, vertical: boolean, side: LaneSide): boolean {
	if (longitudinal(start, vertical) !== longitudinal(next, vertical)) return false;
	if (side === 1) return cross(next, vertical) > cross(start, vertical);
	return cross(next, vertical) < cross(start, vertical);
}

function recordPort(
	context: RouteContext,
	endpointId: string,
	side: LaneSide,
	position: number,
): void {
	const key = JSON.stringify([endpointId, side]);
	const positions = context.ports.get(key) ?? [];
	positions.push(position);
	context.ports.set(key, positions);
}

function attachedTransverse(
	point: Point,
	bounds: Bounds,
	vertical: boolean,
	side: LaneSide,
): boolean {
	let expected = longStart(bounds, vertical);
	if (side === 1) expected = longEnd(bounds, vertical);
	const port = cross(point, vertical);
	const afterStart = port >= crossStart(bounds, vertical) + PORT_INSET;
	const beforeEnd = port <= crossEnd(bounds, vertical) - PORT_INSET;
	return longitudinal(point, vertical) === expected && afterStart && beforeEnd;
}

function transversePortDirection(
	start: Point,
	next: Point,
	vertical: boolean,
	side: LaneSide,
): boolean {
	if (cross(start, vertical) !== cross(next, vertical)) return false;
	if (side === 1) return longitudinal(next, vertical) > longitudinal(start, vertical);
	return longitudinal(next, vertical) < longitudinal(start, vertical);
}

function transverseRouteEndpoints(
	route: LayoutRelation,
	context: RouteContext,
	from: string,
	to: string,
): string | undefined {
	const source = defined(context.boxes.get(from));
	const target = defined(context.boxes.get(to));
	const sourceLane = context.geometry.lanes.findIndex((lane) => inside(source.bounds, lane.bounds));
	const targetLane = context.geometry.lanes.findIndex((lane) => inside(target.bounds, lane.bounds));
	const sides = transverseRouteSides({
		sourceLane,
		targetLane,
		source: source.bounds,
		target: target.bounds,
		vertical: context.vertical,
	});
	const sourceSide = physicalTransverseSide(sides.source, context.reverse);
	let targetSide = physicalTransverseSide(sides.target, context.reverse);
	const first = route.points[0];
	const second = route.points[1];
	const last = route.points.at(-1);
	const beforeLast = route.points.at(-2);
	if (first === undefined || second === undefined) return `Route ${route.id} is empty.`;
	if (last === undefined || beforeLast === undefined) return `Route ${route.id} is empty.`;
	const arcTarget = sides.arcTarget ?? sides.target;
	if (!attachedTransverse(last, target.bounds, context.vertical, targetSide))
		targetSide = physicalTransverseSide(arcTarget, context.reverse);
	if (!attachedTransverse(first, source.bounds, context.vertical, sourceSide))
		return `Route ${route.id} leaves the wrong source face.`;
	if (!attachedTransverse(last, target.bounds, context.vertical, targetSide))
		return `Route ${route.id} reaches the wrong target face.`;
	if (!transversePortDirection(first, second, context.vertical, sourceSide))
		return `Route ${route.id} leaves the source inward.`;
	if (!transversePortDirection(last, beforeLast, context.vertical, targetSide))
		return `Route ${route.id} reaches the target from inside.`;
	recordPort(context, from, sourceSide, cross(first, context.vertical));
	recordPort(context, to, targetSide, cross(last, context.vertical));
	return undefined;
}

function routeEndpoints(
	route: LayoutRelation,
	context: RouteContext,
	from: string,
	to: string,
): string | undefined {
	if (context.orientation === LaneOrientation.Transverse)
		return transverseRouteEndpoints(route, context, from, to);
	const source = defined(context.boxes.get(from));
	const target = defined(context.boxes.get(to));
	const laneIds = context.geometry.lanes.map(({ id }) => id);
	const sourceLane = context.geometry.lanes.findIndex((lane) => inside(source.bounds, lane.bounds));
	const targetLane = context.geometry.lanes.findIndex((lane) => inside(target.bounds, lane.bounds));
	const sourceSide = laneSide(sourceLane, targetLane, laneIds.length);
	const targetSide = laneSide(targetLane, sourceLane, laneIds.length);
	const first = route.points[0];
	const second = route.points[1];
	const last = route.points.at(-1);
	const beforeLast = route.points.at(-2);
	if (first === undefined || second === undefined) return `Route ${route.id} is empty.`;
	if (last === undefined || beforeLast === undefined) return `Route ${route.id} is empty.`;
	if (!attached(first, source.bounds, context.vertical, sourceSide))
		return `Route ${route.id} leaves the wrong source face.`;
	if (!attached(last, target.bounds, context.vertical, targetSide))
		return `Route ${route.id} reaches the wrong target face.`;
	if (!portDirection(first, second, context.vertical, sourceSide))
		return `Route ${route.id} leaves the source inward.`;
	if (!portDirection(last, beforeLast, context.vertical, targetSide))
		return `Route ${route.id} reaches the target from inside.`;
	recordPort(context, from, sourceSide, longitudinal(first, context.vertical));
	recordPort(context, to, targetSide, longitudinal(last, context.vertical));
	return undefined;
}

interface RouteSegment {
	readonly index: number;
	readonly start: Point;
	readonly end: Point;
}

function segmentHitsBox(
	route: LayoutRelation,
	segment: RouteSegment,
	context: RouteGeometryContext,
): string | undefined {
	const lastIndex = route.points.length - 1;
	for (const box of context.boxes.values()) {
		context.charge?.(1);
		if (box.id === route.from && segment.index === 1) continue;
		if (box.id === route.to && segment.index === lastIndex) continue;
		if (hitsBox(segment.start, segment.end, box.bounds, context.clearance))
			return `Route ${route.id} touches element ${box.id}.`;
	}
	return undefined;
}

function segmentCrossesItself(
	route: LayoutRelation,
	segment: RouteSegment,
	charge?: RouteWorkCharge,
): boolean {
	for (let other = segment.index + 2; other < route.points.length; other += 1) {
		charge?.(1);
		const otherStart = route.points[other - 1];
		const otherEnd = route.points[other];
		if (otherStart === undefined || otherEnd === undefined) continue;
		if (segmentsSelfContact(segment.start, segment.end, otherStart, otherEnd)) return true;
	}
	return false;
}

function withinCanvas(point: Point, geometry: SharedLaneGeometry): boolean {
	const horizontal = point.x >= 0 && point.x <= geometry.width;
	const vertical = point.y >= 0 && point.y <= geometry.height;
	return horizontal && vertical;
}

function routeSegments(route: LayoutRelation, context: RouteGeometryContext): string | undefined {
	for (let index = 1; index < route.points.length; index += 1) {
		const start = route.points[index - 1];
		const end = route.points[index];
		if (start === undefined || end === undefined) return `Route ${route.id} is incomplete.`;
		if (!finiteOrthogonalSegment(start, end))
			return `Route ${route.id} has a non-orthogonal or empty segment.`;
		if (!withinCanvas(start, context.geometry) || !withinCanvas(end, context.geometry))
			return `Route ${route.id} escapes the canvas.`;
		const obstacle = segmentHitsBox(route, { index, start, end }, context);
		if (obstacle !== undefined) return obstacle;
		if (segmentCrossesItself(route, { index, start, end }, context.charge))
			return `Route ${route.id} crosses itself.`;
	}
	return undefined;
}

function validatePortSeparation(ports: ReadonlyMap<string, number[]>): string | undefined {
	for (const [key, positions] of ports) {
		positions.sort((a, b) => a - b);
		for (let index = 1; index < positions.length; index += 1) {
			const current = defined(positions[index]);
			const previous = defined(positions[index - 1]);
			const gap = current - previous;
			if (gap < PORT_SPACING) return `Ports on ${key} are too close.`;
		}
	}
	return undefined;
}

export function validateSharedLaneRouteShapes(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
	clearance: number,
	charge?: RouteWorkCharge,
): string | undefined {
	charge?.(graph.relations.length + geometry.elements.length);
	const relationById = new Map(graph.relations.map(({ relation }) => [relation.id, relation]));
	if (geometry.relations.length !== relationById.size) return 'The relation set is incomplete.';
	const context: RouteContext = {
		geometry,
		orientation: defined(graph.document.presentation).laneOrientation,
		vertical: verticalDirection(graph.document.layout.direction),
		reverse: reverseDirection(graph.document.layout.direction),
		boxes: new Map(geometry.elements.map((box) => [box.id, box])),
		clearance,
		ports: new Map(),
		charge,
	};
	const seen = new Set<string>();
	for (const route of geometry.relations) {
		charge?.(2 * geometry.lanes.length + route.points.length);
		if (seen.has(route.id)) return `Route identity differs at ${route.id}.`;
		seen.add(route.id);
		const relation = relationById.get(route.id);
		if (relation === undefined) return `Route identity differs at ${route.id}.`;
		if (route.from !== relation.from || route.to !== relation.to)
			return `Route endpoints differ at ${route.id}.`;
		const endpointIssue = routeEndpoints(route, context, relation.from, relation.to);
		if (endpointIssue !== undefined) return endpointIssue;
		const segmentIssue = routeSegments(route, context);
		if (segmentIssue !== undefined) return segmentIssue;
	}
	return validatePortSeparation(context.ports);
}

/** Port positions and route identities are fixed by the frame; only track-dependent segments move. */
export function validateChangedSharedLaneRoutes(
	geometry: SharedLaneGeometry,
	clearance: number,
	changedRouteIds: ReadonlySet<string>,
	charge?: RouteWorkCharge,
): string | undefined {
	charge?.(geometry.elements.length + geometry.relations.length);
	const context = {
		geometry,
		boxes: new Map(geometry.elements.map((box) => [box.id, box])),
		clearance,
		charge,
	};
	for (const route of geometry.relations) {
		if (changedRouteIds.has(route.id)) {
			const issue = routeSegments(route, context);
			if (issue !== undefined) return issue;
		}
	}
	return undefined;
}

export function validateSharedLaneRoutes(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
	clearance: number,
	acceptBridges: boolean,
): string | undefined {
	const shapeIssue = validateSharedLaneRouteShapes(graph, geometry, clearance);
	if (shapeIssue !== undefined) return shapeIssue;
	return validateSharedLaneRouteContacts(geometry.relations, acceptBridges);
}
