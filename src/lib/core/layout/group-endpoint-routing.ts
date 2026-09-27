import { defined, EndpointKind } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { disallowedRouteContacts } from './bridges/bridge-contact';
import { routeBridgeAnalysis } from './bridges/bridge-oracle';
import { validateSelfContacts } from './bridges/route-self-contacts';
import { routePathBounds } from './geometry/box-geometry';
import { type LayoutFrame, pointOnAxes } from './geometry/layout-frame';
import {
	JUNCTION_PORT_INSET,
	JUNCTION_PORT_SPACING,
	PORT_INSET,
	PORT_SPACING,
	RAIL_SPACING,
} from './layout-settings';
import { type Bounds, GroupRouteFailure, type LayoutRelation, type Point } from './layout-types';
import { foreignGroupObstacles } from './routing/group-passages';
import {
	candidateTracks,
	type GroupTrackIndex,
	prepareGroupTrackIndex,
} from './routing/group-track-index';
import {
	prepareRouteEnvelopeIndex,
	replaceRouteEnvelope,
	type RouteEnvelopeIndex,
	routeEnvelopeNeighbors,
} from './routing/route-envelope-index';
import {
	prepareRouteObstacles,
	routeHitsObstacles,
	type RouteObstacles,
} from './routing/route-obstacles';

function main(point: Point, vertical: boolean): number {
	if (vertical) return point.y;
	return point.x;
}

function transverse(point: Point, vertical: boolean): number {
	if (vertical) return point.x;
	return point.y;
}

const PORT_OFFSETS = [
	0,
	PORT_SPACING,
	-PORT_SPACING,
	RAIL_SPACING,
	-RAIL_SPACING,
	JUNCTION_PORT_SPACING,
	-JUNCTION_PORT_SPACING,
];
const HALF_RAIL = RAIL_SPACING / 2;
const DOUBLE_RAIL = RAIL_SPACING * 2;
const TRIPLE_RAIL = RAIL_SPACING * 3;
const CLEARANCE_PAIRS = [
	[RAIL_SPACING, RAIL_SPACING],
	[DOUBLE_RAIL, DOUBLE_RAIL],
	[TRIPLE_RAIL, TRIPLE_RAIL],
	[RAIL_SPACING, HALF_RAIL],
	[DOUBLE_RAIL, HALF_RAIL],
	[TRIPLE_RAIL, HALF_RAIL],
] as const;

interface RoutingContext {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly frame: LayoutFrame;
	readonly vertical: boolean;
	readonly routes: LayoutRelation[];
	readonly nodes: RouteObstacles;
	readonly contactIndex: RouteEnvelopeIndex;
	readonly neighbors: number[];
	activeIndex: number;
	readonly ancestorCache: Map<string, readonly string[]>;
	readonly groupObstacleCache: Map<string, RouteObstacles | undefined>;
	tracks: GroupTrackIndex | undefined;
	outside: number;
}

function endpoint(route: LayoutRelation, source: boolean): { id: string; port: Point } {
	if (source) return { id: route.from, port: defined(route.points[0]) };
	return { id: route.to, port: defined(route.points.at(-1)) };
}

function portInUse(
	context: RoutingContext,
	route: LayoutRelation,
	source: boolean,
	coordinate: number,
): boolean {
	const { id } = endpoint(route, source);
	for (const other of context.routes) {
		if (other.id === route.id) continue;
		const face = endpoint(other, source);
		if (face.id !== id) continue;
		const distance = Math.abs(coordinate - transverse(face.port, context.vertical));
		if (distance < PORT_SPACING) return true;
	}
	return false;
}

function shiftedPort(
	context: RoutingContext,
	route: LayoutRelation,
	source: boolean,
	offset: number,
): Point | undefined {
	const { id, port } = endpoint(route, source);
	if (offset === 0) return port;
	const kind = defined(context.graph.endpointsById.get(id)).kind;
	if (kind === EndpointKind.Node && Math.abs(offset) !== PORT_SPACING) return undefined;
	if (kind === EndpointKind.Junction && Math.abs(offset) !== JUNCTION_PORT_SPACING)
		return undefined;
	const box = defined(context.bounds.get(id));
	let start = box.y;
	let length = box.height;
	if (context.vertical) {
		start = box.x;
		length = box.width;
	}
	let inset = PORT_INSET;
	if (kind === EndpointKind.Junction) inset = JUNCTION_PORT_INSET;
	const coordinate = transverse(port, context.vertical) + offset;
	const low = start + inset;
	const high = start + length - inset;
	if (coordinate < low || coordinate > high) return undefined;
	if (portInUse(context, route, source, coordinate)) return undefined;
	return pointOnAxes(coordinate, main(port, context.vertical), context.vertical);
}

interface FacePorts {
	readonly source: Point;
	readonly target: Point;
}

function exteriorPath(
	frame: LayoutFrame,
	track: number,
	ports: FacePorts,
	clearances: readonly [number, number],
): readonly Point[] {
	const first = ports.source;
	const last = ports.target;
	let outgoing = -1;
	if (!frame.forward) outgoing = 1;
	const source = main(first, frame.vertical) + outgoing * clearances[0];
	const target = main(last, frame.vertical) - outgoing * clearances[1];
	const sourceCoordinate = transverse(first, frame.vertical);
	const targetCoordinate = transverse(last, frame.vertical);
	return [
		first,
		pointOnAxes(sourceCoordinate, source, frame.vertical),
		pointOnAxes(track, source, frame.vertical),
		pointOnAxes(track, target, frame.vertical),
		pointOnAxes(targetCoordinate, target, frame.vertical),
		last,
	];
}

function contactsAnotherRoute(candidate: LayoutRelation, context: RoutingContext): boolean {
	if (!validateSelfContacts(candidate)) return true;
	const envelope = routePathBounds(candidate);
	routeEnvelopeNeighbors(context.contactIndex, envelope, context.activeIndex, context.neighbors);
	for (const index of context.neighbors) {
		const other = defined(context.routes[index]);
		const bridges = routeBridgeAnalysis([candidate, other]).bridges;
		if (disallowedRouteContacts(candidate, other, bridges).length > 0) return true;
	}
	return false;
}

function admissiblePath(
	context: RoutingContext,
	candidate: LayoutRelation,
	groups: RouteObstacles | undefined,
): boolean {
	if (candidate.points.some(({ x, y }) => x < 0 || y < 0)) return false;
	if (routeHitsObstacles(candidate.points, context.nodes)) return false;
	if (groups !== undefined && routeHitsObstacles(candidate.points, groups)) return false;
	return !contactsAnotherRoute(candidate, context);
}

interface RouteAttempt {
	readonly route: LayoutRelation;
	readonly groups: RouteObstacles | undefined;
}

function pathOnTrack(
	context: RoutingContext,
	attempt: RouteAttempt,
	ports: FacePorts,
	track: number,
): LayoutRelation | undefined {
	for (const clearances of CLEARANCE_PAIRS) {
		const points = exteriorPath(context.frame, track, ports, clearances);
		const candidate = { ...attempt.route, points };
		if (admissiblePath(context, candidate, attempt.groups)) return candidate;
	}
	return undefined;
}

function pathForPorts(
	context: RoutingContext,
	attempt: RouteAttempt,
	ports: FacePorts,
): LayoutRelation | undefined {
	context.tracks ??= prepareGroupTrackIndex(context.bounds, context.vertical);
	const source = transverse(ports.source, context.vertical);
	const target = transverse(ports.target, context.vertical);
	for (const track of candidateTracks(context.tracks, source, target)) {
		const candidate = pathOnTrack(context, attempt, ports, track);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

function alternateRoute(
	context: RoutingContext,
	route: LayoutRelation,
	groups: RouteObstacles | undefined,
): LayoutRelation | undefined {
	for (const sourceOffset of PORT_OFFSETS) {
		const source = shiftedPort(context, route, true, sourceOffset);
		if (source === undefined) continue;
		for (const targetOffset of PORT_OFFSETS) {
			const target = shiftedPort(context, route, false, targetOffset);
			if (target === undefined) continue;
			const candidate = pathForPorts(context, { route, groups }, { source, target });
			if (candidate !== undefined) return candidate;
		}
	}
	return undefined;
}

function exteriorForPorts(
	context: RoutingContext,
	attempt: RouteAttempt,
	ports: FacePorts,
): LayoutRelation | undefined {
	for (let index = 1; index <= context.routes.length + 1; index += 1) {
		const track = context.outside + index * RAIL_SPACING;
		const candidate = pathOnTrack(context, attempt, ports, track);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

/** Beyond every current box and route, each next track is a genuinely free exterior rail. */
function freshExterior(
	context: RoutingContext,
	route: LayoutRelation,
	groups: RouteObstacles | undefined,
): LayoutRelation | undefined {
	const attempt = { route, groups };
	for (const sourceOffset of PORT_OFFSETS) {
		const source = shiftedPort(context, route, true, sourceOffset);
		if (source === undefined) continue;
		for (const targetOffset of PORT_OFFSETS) {
			const target = shiftedPort(context, route, false, targetOffset);
			if (target === undefined) continue;
			const candidate = exteriorForPorts(context, attempt, { source, target });
			if (candidate !== undefined) return candidate;
		}
	}
	return undefined;
}

function prepareRoutingContext(
	graph: LogicGraph,
	bounds: ReadonlyMap<string, Bounds>,
	frame: LayoutFrame,
	routes: LayoutRelation[],
): RoutingContext {
	const boxes: Bounds[] = [];
	for (const id of graph.rankableEndpointIds) {
		if (defined(graph.endpointsById.get(id)).kind === EndpointKind.Group) continue;
		boxes.push(defined(bounds.get(id)));
	}
	let outside = 0;
	for (const box of bounds.values()) {
		let edge = box.y + box.height;
		if (frame.vertical) edge = box.x + box.width;
		outside = Math.max(outside, edge);
	}
	for (const route of routes)
		for (const point of route.points)
			outside = Math.max(outside, transverse(point, frame.vertical));
	return {
		graph,
		bounds,
		frame,
		vertical: frame.vertical,
		routes,
		nodes: prepareRouteObstacles(boxes, 0),
		contactIndex: prepareRouteEnvelopeIndex(routes.map(routePathBounds)),
		neighbors: [],
		activeIndex: 0,
		ancestorCache: new Map<string, readonly string[]>(),
		groupObstacleCache: new Map<string, RouteObstacles | undefined>(),
		tracks: undefined,
		outside,
	};
}

/** Final bounds, rather than logical group ranks, determine which passages need correction. */
export function clearGroupEndpointRoutes(
	graph: LogicGraph,
	bounds: ReadonlyMap<string, Bounds>,
	frame: LayoutFrame,
	routes: LayoutRelation[],
): void {
	if (graph.document.groups.length === 0) return;
	if (
		graph.document.junctions.length === 0 &&
		!graph.relations.some(
			({ source, target }) =>
				source.kind === EndpointKind.Group || target.kind === EndpointKind.Group,
		)
	)
		return;
	const context = prepareRoutingContext(graph, bounds, frame, routes);
	for (const [index, route] of routes.entries()) {
		context.activeIndex = index;
		const groups = foreignGroupObstacles(context, route, 0);
		const hitsNode = routeHitsObstacles(route.points, context.nodes);
		const hitsGroup = groups !== undefined && routeHitsObstacles(route.points, groups);
		if (!hitsNode && !hitsGroup) continue;
		const clearanceGroups = foreignGroupObstacles(context, route);
		let replacement =
			alternateRoute(context, route, clearanceGroups) ??
			freshExterior(context, route, clearanceGroups);
		if (replacement === undefined) {
			// A target can sit only 24px beyond a foreign frame. Preserve physical
			// disjointness when the preferred 24px envelope cannot fit at its face.
			const exactGroups = foreignGroupObstacles(context, route, 0);
			replacement =
				alternateRoute(context, route, exactGroups) ?? freshExterior(context, route, exactGroups);
		}
		if (replacement === undefined) throw new GroupRouteFailure(route.id);
		routes[index] = replacement;
		replaceRouteEnvelope(context.contactIndex, index, routePathBounds(replacement));
		for (const point of replacement.points)
			context.outside = Math.max(context.outside, transverse(point, frame.vertical));
	}
}
