import { defined, EndpointKind } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { disallowedRouteContacts } from './bridges/bridge-contact';
import { routeBridgeAnalysis } from './bridges/bridge-oracle';
import { validateSelfContacts } from './bridges/route-self-contacts';
import { routeBoundsOverlap, routePathBounds } from './geometry/box-geometry';
import { type LayoutFrame, pointOnAxes } from './geometry/layout-frame';
import { PORT_INSET, PORT_SPACING, RAIL_SPACING } from './layout-settings';
import type { Bounds, LayoutRelation, Point } from './layout-types';
import { foreignGroupObstacles } from './routing/group-passages';
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

const PORT_OFFSETS = [0, PORT_SPACING, -PORT_SPACING, RAIL_SPACING, -RAIL_SPACING];

interface RoutingContext {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly frame: LayoutFrame;
	readonly vertical: boolean;
	readonly routes: LayoutRelation[];
	readonly nodes: RouteObstacles;
	readonly envelopes: Bounds[];
	readonly ancestorCache: Map<string, readonly string[]>;
	readonly groupObstacleCache: Map<string, RouteObstacles | undefined>;
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

function shiftedGroupPort(
	context: RoutingContext,
	route: LayoutRelation,
	source: boolean,
	offset: number,
): Point | undefined {
	const { id, port } = endpoint(route, source);
	if (offset === 0) return port;
	if (defined(context.graph.endpointsById.get(id)).kind !== EndpointKind.Group) return undefined;
	const box = defined(context.bounds.get(id));
	let start = box.y;
	let length = box.height;
	if (context.vertical) {
		start = box.x;
		length = box.width;
	}
	const coordinate = transverse(port, context.vertical) + offset;
	const low = start + PORT_INSET;
	const high = start + length - PORT_INSET;
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
	clearance: number,
	ports: FacePorts,
): readonly Point[] {
	const first = ports.source;
	const last = ports.target;
	let outgoing = -1;
	if (!frame.forward) outgoing = 1;
	const source = main(first, frame.vertical) + outgoing * clearance;
	const target = main(last, frame.vertical) - outgoing * clearance;
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

function candidateTracks(
	bounds: ReadonlyMap<string, Bounds>,
	vertical: boolean,
	source: Point,
	target: Point,
): readonly number[] {
	const sourceCoordinate = transverse(source, vertical);
	const targetCoordinate = transverse(target, vertical);
	const tracks = new Set<number>();
	tracks.add(sourceCoordinate - RAIL_SPACING);
	tracks.add(sourceCoordinate + RAIL_SPACING);
	tracks.add(targetCoordinate - RAIL_SPACING);
	tracks.add(targetCoordinate + RAIL_SPACING);
	for (const box of bounds.values()) {
		let start = box.y;
		let size = box.height;
		if (vertical) {
			start = box.x;
			size = box.width;
		}
		tracks.add(start - RAIL_SPACING);
		tracks.add(start + size + RAIL_SPACING);
	}
	return [...tracks]
		.filter((coordinate) => coordinate >= 0)
		.sort((left, right) => {
			const leftCost = Math.abs(left - sourceCoordinate) + Math.abs(left - targetCoordinate);
			const rightCost = Math.abs(right - sourceCoordinate) + Math.abs(right - targetCoordinate);
			return leftCost - rightCost || left - right;
		});
}

function contactsAnotherRoute(candidate: LayoutRelation, context: RoutingContext): boolean {
	if (!validateSelfContacts(candidate)) return true;
	const envelope = routePathBounds(candidate);
	for (const [index, other] of context.routes.entries()) {
		if (candidate.id === other.id) continue;
		const otherEnvelope = defined(context.envelopes[index]);
		if (!routeBoundsOverlap(envelope, otherEnvelope)) continue;
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

function pathForPorts(
	context: RoutingContext,
	route: LayoutRelation,
	groups: RouteObstacles | undefined,
	ports: FacePorts,
): LayoutRelation | undefined {
	for (const track of candidateTracks(
		context.bounds,
		context.vertical,
		ports.source,
		ports.target,
	)) {
		for (let stub = 1; stub <= 3; stub += 1) {
			const points = exteriorPath(context.frame, track, stub * RAIL_SPACING, ports);
			const candidate = { ...route, points };
			if (admissiblePath(context, candidate, groups)) return candidate;
		}
	}
	return undefined;
}

function alternateRoute(
	context: RoutingContext,
	route: LayoutRelation,
	groups: RouteObstacles | undefined,
): LayoutRelation | undefined {
	for (const sourceOffset of PORT_OFFSETS) {
		const source = shiftedGroupPort(context, route, true, sourceOffset);
		if (source === undefined) continue;
		for (const targetOffset of PORT_OFFSETS) {
			const target = shiftedGroupPort(context, route, false, targetOffset);
			if (target === undefined) continue;
			const candidate = pathForPorts(context, route, groups, { source, target });
			if (candidate !== undefined) return candidate;
		}
	}
	return undefined;
}

function needsGroupRouting(graph: LogicGraph): boolean {
	if (graph.document.groups.length === 0) return false;
	if (graph.document.junctions.length > 0) return true;
	return graph.relations.some(
		({ source, target }) =>
			source.kind === EndpointKind.Group || target.kind === EndpointKind.Group,
	);
}

/** Final bounds, rather than logical group ranks, determine which passages need correction. */
export function clearGroupEndpointRoutes(
	graph: LogicGraph,
	bounds: ReadonlyMap<string, Bounds>,
	frame: LayoutFrame,
	routes: LayoutRelation[],
): void {
	if (!needsGroupRouting(graph)) return;
	const boxes: Bounds[] = [];
	for (const id of graph.rankableEndpointIds) {
		if (defined(graph.endpointsById.get(id)).kind === EndpointKind.Group) continue;
		boxes.push(defined(bounds.get(id)));
	}
	const context: RoutingContext = {
		graph,
		bounds,
		frame,
		vertical: frame.vertical,
		routes,
		nodes: prepareRouteObstacles(boxes, 0),
		envelopes: routes.map(routePathBounds),
		ancestorCache: new Map<string, readonly string[]>(),
		groupObstacleCache: new Map<string, RouteObstacles | undefined>(),
	};
	for (const [index, route] of routes.entries()) {
		const groups = foreignGroupObstacles(context, route, 0);
		const hitsNode = routeHitsObstacles(route.points, context.nodes);
		const hitsGroup = groups !== undefined && routeHitsObstacles(route.points, groups);
		if (!hitsNode && !hitsGroup) continue;
		const replacement = alternateRoute(context, route, foreignGroupObstacles(context, route));
		if (replacement === undefined) continue;
		routes[index] = replacement;
		context.envelopes[index] = routePathBounds(replacement);
	}
}
