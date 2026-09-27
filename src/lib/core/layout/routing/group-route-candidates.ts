import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { routePathBounds } from '../geometry/box-geometry';
import { type LayoutFrame, pointOnAxes } from '../geometry/layout-frame';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import type { Bounds, LayoutRelation, Point } from '../layout-types';
import { main, transverse } from './group-exterior-path';
import type { GroupTrackIndex } from './group-track-index';
import { prepareRouteEnvelopeIndex, type RouteEnvelopeIndex } from './route-envelope-index';
import { prepareRouteObstacles, type RouteObstacles } from './route-obstacles';

export interface RoutingContext {
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

export function shiftedGroupPort(
	context: RoutingContext,
	route: LayoutRelation,
	source: boolean,
	offset: number,
): Point | undefined {
	const { id, port } = endpoint(route, source);
	if (offset === 0) return port;
	if (defined(context.graph.endpointsById.get(id)).kind === EndpointKind.Junction) return undefined;
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

export function respectsExternalFlow(context: RoutingContext, candidate: LayoutRelation): boolean {
	const sourceEndpoint = defined(context.graph.endpointsById.get(candidate.from));
	const targetEndpoint = defined(context.graph.endpointsById.get(candidate.to));
	if (sourceEndpoint.kind !== EndpointKind.Node || targetEndpoint.kind !== EndpointKind.Node)
		return true;
	if (sourceEndpoint.entity.groupId !== undefined) return true;
	if (targetEndpoint.entity.groupId !== undefined) return true;
	let sign = 1;
	if (context.frame.forward) sign = -1;
	const source = main(defined(candidate.points[0]), context.vertical);
	const target = main(defined(candidate.points.at(-1)), context.vertical);
	if ((target - source) * sign < 0) return true;
	for (let index = 1; index < candidate.points.length; index += 1) {
		const current = main(defined(candidate.points[index]), context.vertical);
		const previous = main(defined(candidate.points[index - 1]), context.vertical);
		if ((current - previous) * sign < 0) return false;
	}
	return true;
}

export function prepareRoutingContext(
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
