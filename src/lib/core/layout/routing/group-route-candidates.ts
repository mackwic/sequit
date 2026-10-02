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
		pending: new Set(),
		activeIndex: 0,
		ancestorCache: new Map<string, readonly string[]>(),
		groupObstacleCache: new Map<string, RouteObstacles | undefined>(),
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

/** Keep each foreign attachment and its normal approach free, including during repair. */
function reservedAttachmentConflict(
	candidate: LayoutRelation,
	other: LayoutRelation,
	frame: LayoutFrame,
): boolean {
	for (let endpoint = 0; endpoint < 2; endpoint++) {
		let id = other.from;
		let port = defined(other.points[0]);
		let outward = 1;
		if (frame.forward) outward = -1;
		if (endpoint === 1) {
			id = other.to;
			port = defined(other.points.at(-1));
			outward = -outward;
		}
		if (endpoint === 0 && id === candidate.from) continue;
		if (endpoint === 1 && id === candidate.to) continue;
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
/** A populated frame can be much wider than its member: search its whole attachment face. */
export function faceOffsets(context: RoutingContext, route: LayoutRelation): readonly number[] {
	const source = defined(context.bounds.get(route.from));
	const target = defined(context.bounds.get(route.to));
	let extent = Math.max(source.height, target.height);
	if (context.vertical) extent = Math.max(source.width, target.width);
	const offsets = [0];
	for (let offset = HALF_RAIL; offset < extent; offset += HALF_RAIL) {
		offsets.push(offset, -offset);
	}
	return offsets;
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
