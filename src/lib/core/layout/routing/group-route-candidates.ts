import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { routePathBounds } from '../geometry/box-geometry';
import { type LayoutFrame, pointOnAxes } from '../geometry/layout-frame';
import { samePoint } from '../geometry/nested-region-geometry-primitives';
import { PORT_INSET, PORT_SPACING, RAIL_SPACING } from '../layout-settings';
import type { Bounds, LayoutRelation, Point } from '../layout-types';
import { type FacePorts, main, transverse } from './group-exterior-path';
import type { GroupTrackIndex } from './group-track-index';
import { prepareRouteEnvelopeIndex, type RouteEnvelopeIndex } from './route-envelope-index';
import { prepareRouteObstacles, type RouteObstacles } from './route-obstacles';

const HALF_RAIL = RAIL_SPACING / 2;

export interface RoutingContext {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly frame: LayoutFrame;
	readonly vertical: boolean;
	readonly routes: LayoutRelation[];
	readonly nodes: RouteObstacles;
	readonly contactIndex: RouteEnvelopeIndex;
	readonly neighbors: number[];
	readonly pending: Set<number>;
	activeIndex: number;
	readonly ancestorCache: Map<string, readonly string[]>;
	readonly groupObstacleCache: Map<string, RouteObstacles | undefined>;
	/**
	 * Paths of the route under repair that its reservations refused. Cleared before each repair:
	 * routes, pending set and active index stay fixed during one, so a path's verdict does too.
	 */
	readonly refusedPaths: Set<string>;
	tracks: GroupTrackIndex | undefined;
	outside: number;
}
export interface RouteAttempt {
	readonly route: LayoutRelation;
	readonly groups: RouteObstacles | undefined;
}
export interface ExteriorAttempt extends RouteAttempt {
	readonly ports: FacePorts;
	readonly rails: readonly number[];
}

export function endpoint(route: LayoutRelation, source: boolean): { id: string; port: Point } {
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
	const groupFace = defined(context.graph.endpointsById.get(id)).kind === EndpointKind.Group;
	for (let index = 0; index < context.routes.length; index++) {
		if (context.pending.has(index) && !groupFace) continue;
		const other = defined(context.routes[index]);
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
/** Preserve the same source-first and target-second offset order across every fallback. */
export function* candidateFacePorts(
	context: RoutingContext,
	route: LayoutRelation,
	offsets: readonly number[],
): Generator<FacePorts> {
	for (const sourceOffset of offsets) {
		const source = shiftedGroupPort(context, route, true, sourceOffset);
		if (source === undefined) continue;
		for (const targetOffset of offsets) {
			const target = shiftedGroupPort(context, route, false, targetOffset);
			if (target !== undefined) yield { source, target };
		}
	}
}

/**
 * A route between two ungrouped nodes whose target lies downstream must progress along the main
 * axis: every segment times the returned sign stays non-negative. Zero exempts the route.
 */
export function externalFlowSign(
	context: RoutingContext,
	route: LayoutRelation,
	ports: FacePorts,
): number {
	const sourceEndpoint = defined(context.graph.endpointsById.get(route.from));
	const targetEndpoint = defined(context.graph.endpointsById.get(route.to));
	if (sourceEndpoint.kind !== EndpointKind.Node || targetEndpoint.kind !== EndpointKind.Node)
		return 0;
	if (sourceEndpoint.entity.groupId !== undefined) return 0;
	if (targetEndpoint.entity.groupId !== undefined) return 0;
	let sign = 1;
	if (context.frame.forward) sign = -1;
	const source = main(ports.source, context.vertical);
	const target = main(ports.target, context.vertical);
	if ((target - source) * sign < 0) return 0;
	return sign;
}

export function respectsExternalFlow(context: RoutingContext, candidate: LayoutRelation): boolean {
	const sign = externalFlowSign(context, candidate, {
		source: defined(candidate.points[0]),
		target: defined(candidate.points.at(-1)),
	});
	if (sign === 0) return true;
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
		pending: new Set(),
		activeIndex: 0,
		ancestorCache: new Map<string, readonly string[]>(),
		groupObstacleCache: new Map<string, RouteObstacles | undefined>(),
		refusedPaths: new Set<string>(),
		tracks: undefined,
		outside,
	};
}

function attachmentConflict(
	candidate: LayoutRelation,
	port: Point,
	frame: LayoutFrame,
	outward: number,
): boolean {
	const origin = main(port, frame.vertical);
	const tip = origin + outward * RAIL_SPACING;
	const low = Math.min(origin, tip);
	const high = Math.max(origin, tip);
	const cross = transverse(port, frame.vertical);
	for (let index = 1; index < candidate.points.length; index++) {
		const start = defined(candidate.points[index - 1]);
		const end = defined(candidate.points[index]);
		const onX = port.x >= Math.min(start.x, end.x) && port.x <= Math.max(start.x, end.x);
		const onY = port.y >= Math.min(start.y, end.y) && port.y <= Math.max(start.y, end.y);
		if (onX && onY) return true;
		if (transverse(start, frame.vertical) !== cross || transverse(end, frame.vertical) !== cross)
			continue;
		const first = main(start, frame.vertical);
		const last = main(end, frame.vertical);
		if (Math.min(Math.max(first, last), high) > Math.max(Math.min(first, last), low)) return true;
	}
	return false;
}

/**
 * Keep each foreign attachment and its normal approach free, including during repair. A route
 * may only run through an attachment it shares; a distinct port of a common endpoint stays free.
 */
function reservedAttachmentConflict(
	candidate: LayoutRelation,
	other: LayoutRelation,
	frame: LayoutFrame,
): boolean {
	for (let side = 0; side < 2; side++) {
		let id = other.from;
		let port = defined(other.points[0]);
		let own = endpoint(candidate, true);
		let outward = 1;
		if (frame.forward) outward = -1;
		if (side === 1) {
			id = other.to;
			port = defined(other.points.at(-1));
			own = endpoint(candidate, false);
			outward = -outward;
		}
		if (id === own.id && samePoint(port, own.port)) continue;
		if (attachmentConflict(candidate, port, frame, outward)) return true;
	}
	return false;
}

/** Whether `candidate` occupies an attachment reserved by one of the indexed routes. */
export function attachmentReservedBy(
	context: RoutingContext,
	candidate: LayoutRelation,
	indexes: Iterable<number>,
): boolean {
	for (const index of indexes) {
		if (index === context.activeIndex) continue;
		const other = defined(context.routes[index]);
		if (reservedAttachmentConflict(candidate, other, context.frame)) return true;
	}
	return false;
}
/**
 * A populated frame can be much wider than its member: search its whole attachment face, by
 * increasing offset. The ports within one port spacing of their current position are first
 * searched at every clearance: an exhausted search of a wide face costs seconds, and most repairs
 * keep a nearby port.
 */
export function faceOffsetWindows(
	context: RoutingContext,
	route: LayoutRelation,
): readonly (readonly number[])[] {
	const source = defined(context.bounds.get(route.from));
	const target = defined(context.bounds.get(route.to));
	let extent = Math.max(source.height, target.height);
	if (context.vertical) extent = Math.max(source.width, target.width);
	const offsets = [0];
	for (let offset = HALF_RAIL; offset < extent; offset += HALF_RAIL) {
		offsets.push(offset, -offset);
	}
	const near = offsets.filter((offset) => Math.abs(offset) <= PORT_SPACING);
	if (near.length === offsets.length) return [offsets];
	return [near, offsets];
}

/** A shared source must be able to follow the escape of its already repaired sibling. */
export function* sharedSourceEscapes(
	context: RoutingContext,
	route: LayoutRelation,
	source: Point,
): Generator<readonly [number, number]> {
	for (let index = 0; index < context.routes.length; index++) {
		if (context.pending.has(index) || context.activeIndex === index) continue;
		const other = defined(context.routes[index]);
		if (other.from !== route.from || !samePoint(defined(other.points[0]), source)) continue;
		for (const point of other.points)
			yield [main(point, context.vertical), transverse(point, context.vertical)];
	}
}

/**
 * A broken route cannot reserve a passage, nor take one from another route. The routes broken on
 * their own are released first; then the group routes contacting a route still in place, and only
 * then the planned routes: group routes have no reserved rail, so a planned route touching
 * released group routes alone keeps its rail. Planned routes come first in the repair order.
 */
export function releasedRoutes(
	context: RoutingContext,
	broken: (route: LayoutRelation) => boolean,
	contacts: (route: LayoutRelation) => boolean,
): number[] {
	const { graph, routes, pending } = context;
	const groupRoutes = routes.map((route) =>
		[route.from, route.to].some((id) => graph.endpointsById.get(id)?.kind === EndpointKind.Group),
	);
	const order = [...routes.keys()].sort(
		(left, right) => Number(groupRoutes[left]) - Number(groupRoutes[right]),
	);
	const fails = (index: number, check: (route: LayoutRelation) => boolean): boolean => {
		context.activeIndex = index;
		return check(defined(routes[index]));
	};
	for (const index of order) if (fails(index, broken)) pending.add(index);
	for (const yields of [true, false]) {
		const tier = order.filter((index) => groupRoutes[index] === yields && !pending.has(index));
		for (const index of tier.filter((member) => fails(member, contacts))) pending.add(index);
	}
	return order.filter((index) => pending.has(index));
}

/** Repair a common-port family together, starting with the route that exposed the obstruction. */
export function releaseSharedPortFamilies(context: RoutingContext, repairs: number[]): void {
	for (const index of repairs) context.pending.add(index);
	for (const index of repairs) {
		const route = defined(context.routes[index]);
		const target = defined(route.points.at(-1));
		for (let otherIndex = 0; otherIndex < context.routes.length; otherIndex++) {
			if (context.pending.has(otherIndex)) continue;
			const other = defined(context.routes[otherIndex]);
			const sourceShared =
				route.from === other.from && samePoint(defined(route.points[0]), defined(other.points[0]));
			const targetShared = route.to === other.to && samePoint(target, defined(other.points.at(-1)));
			if (!sourceShared && !targetShared) continue;
			context.pending.add(otherIndex);
			repairs.push(otherIndex);
		}
	}
}
