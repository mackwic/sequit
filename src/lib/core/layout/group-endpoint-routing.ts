import { defined, EndpointKind } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { unbridgesForeignCrossing } from './bridges/bridge-carrier-displacement';
import { disallowedRouteContacts } from './bridges/bridge-contact';
import { sharedAtEndpoint } from './bridges/bridge-contact-shared';
import { routeBridgeAnalysis } from './bridges/bridge-oracle';
import { validateSelfContacts } from './bridges/route-self-contacts';
import { routePathBounds } from './geometry/box-geometry';
import type { LayoutFrame } from './geometry/layout-frame';
import { samePoint } from './geometry/nested-region-geometry-primitives';
import { JUNCTION_PORT_SPACING, PORT_SPACING, RAIL_SPACING } from './layout-settings';
import { type Bounds, GroupRouteFailure, type LayoutRelation } from './layout-types';
import { boundaryForPorts } from './routing/group-boundary-routes';
import {
	aroundPath,
	exteriorMainRails,
	exteriorPath,
	type FacePorts,
	transverse,
} from './routing/group-exterior-path';
import { foreignGroupObstacles } from './routing/group-passages';
import {
	attachmentReservedBy,
	candidateFacePorts,
	endpoint,
	type ExteriorAttempt,
	faceOffsetWindows,
	prepareRoutingContext,
	releasedRoutes,
	releaseSharedPortFamilies,
	respectsExternalFlow,
	type RouteAttempt,
	type RoutingContext,
} from './routing/group-route-candidates';
import { candidateTracks, prepareGroupTrackIndex } from './routing/group-track-index';
import { replaceRouteEnvelope, routeEnvelopeNeighbors } from './routing/route-envelope-index';
import { routeHitsObstacles, type RouteObstacles } from './routing/route-obstacles';

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
	[HALF_RAIL, HALF_RAIL],
] as const;

/** Shared ports require a continuous trunk; distinct ports preserve the endpoint spacing. */
function sharedPortsConflict(
	candidate: LayoutRelation,
	other: LayoutRelation,
	context: RoutingContext,
): boolean {
	for (let face = 0; face < 2; face++) {
		const source = face === 0;
		const first = endpoint(candidate, source);
		const second = endpoint(other, source);
		if (first.id !== second.id) continue;
		let spacing = PORT_SPACING;
		if (defined(context.graph.endpointsById.get(first.id)).kind === EndpointKind.Junction)
			spacing = JUNCTION_PORT_SPACING;
		const distance = Math.abs(
			transverse(first.port, context.vertical) - transverse(second.port, context.vertical),
		);
		if (distance > 0 && distance < spacing) return true;
		if (
			samePoint(first.port, second.port) &&
			!sharedAtEndpoint(candidate, other, first.port, source)
		)
			return true;
	}
	return false;
}
function contactsAnotherRoute(candidate: LayoutRelation, context: RoutingContext): boolean {
	if (!validateSelfContacts(candidate)) return true;
	for (let index = 0; index < context.routes.length; index++) {
		if (index === context.activeIndex || context.pending.has(index)) continue;
		if (sharedPortsConflict(candidate, defined(context.routes[index]), context)) return true;
	}
	const envelope = routePathBounds(candidate);
	routeEnvelopeNeighbors(context.contactIndex, envelope, context.activeIndex, context.neighbors);
	if (context.neighbors.length === 0) return false;
	const neighboringRoutes: LayoutRelation[] = [candidate];
	for (const index of context.neighbors)
		if (!context.pending.has(index)) neighboringRoutes.push(defined(context.routes[index]));
	const analysis = routeBridgeAnalysis(neighboringRoutes);
	for (let index = 1; index < neighboringRoutes.length; index++) {
		const other = defined(neighboringRoutes[index]);
		if (disallowedRouteContacts(candidate, other, analysis.bridges).length > 0) return true;
	}
	return unbridgesForeignCrossing(analysis, candidate, neighboringRoutes.slice(1));
}

/** The checks of an admissible path that the route reservations decide. */
function reservationsAdmit(context: RoutingContext, candidate: LayoutRelation): boolean {
	let key = '';
	for (const { x, y } of candidate.points) key += `${x},${y};`;
	if (context.refusedPaths.has(key)) return false;
	if (
		attachmentReservedBy(context, candidate, context.pending) ||
		contactsAnotherRoute(candidate, context)
	) {
		context.refusedPaths.add(key);
		return false;
	}
	return true;
}

function admissiblePath(
	context: RoutingContext,
	candidate: LayoutRelation,
	groups: RouteObstacles | undefined,
): boolean {
	if (candidate.points.some(({ x, y }) => x < 0 || y < 0)) return false;
	if (!respectsExternalFlow(context, candidate)) return false;
	if (routeHitsObstacles(candidate.points, context.nodes)) return false;
	if (groups !== undefined && routeHitsObstacles(candidate.points, groups)) return false;
	return reservationsAdmit(context, candidate);
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

function aroundOnTrack(
	context: RoutingContext,
	attempt: ExteriorAttempt,
	targetTrack: number,
): LayoutRelation | undefined {
	for (const mainRail of attempt.rails) {
		const rails = { main: mainRail, target: targetTrack };
		for (const clearances of CLEARANCE_PAIRS) {
			const points = aroundPath(context.frame, attempt.ports, rails, clearances);
			const candidate = { ...attempt.route, points };
			if (admissiblePath(context, candidate, attempt.groups)) return candidate;
		}
	}
	return undefined;
}

function aroundForPorts(
	context: RoutingContext,
	attempt: ExteriorAttempt,
): LayoutRelation | undefined {
	const source = transverse(attempt.ports.source, context.vertical);
	const target = transverse(attempt.ports.target, context.vertical);
	for (const targetTrack of candidateTracks(defined(context.tracks), source, target)) {
		const candidate = aroundOnTrack(context, attempt, targetTrack);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

/** Use a second exterior axis only after every simpler passage has failed. */
function aroundRoute(
	context: RoutingContext,
	route: LayoutRelation,
	groups: RouteObstacles | undefined,
	offsets: readonly number[],
): LayoutRelation | undefined {
	context.tracks ??= prepareGroupTrackIndex(context.bounds, context.vertical);
	const rails = exteriorMainRails(context.bounds, context.routes, context.vertical);
	for (const ports of candidateFacePorts(context, route, offsets)) {
		const attempt = { route, groups, ports, rails };
		const candidate =
			aroundForPorts(context, attempt) ??
			boundaryForPorts(context, attempt, (path) => reservationsAdmit(context, path));
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

function alternateRoute(
	context: RoutingContext,
	route: LayoutRelation,
	groups: RouteObstacles | undefined,
	offsets: readonly number[],
): LayoutRelation | undefined {
	const attempt = { route, groups };
	for (const ports of candidateFacePorts(context, route, offsets)) {
		const candidate = pathForPorts(context, attempt, ports);
		if (candidate !== undefined) return candidate;
	}
	// Beyond every current box and route, every next track is a fresh exterior rail.
	for (const ports of candidateFacePorts(context, route, offsets))
		for (let index = 1; index <= context.routes.length + 1; index += 1) {
			const track = context.outside + index * RAIL_SPACING;
			const candidate = pathOnTrack(context, attempt, ports, track);
			if (candidate !== undefined) return candidate;
		}
	return undefined;
}

/** Obstacles, reserved attachments and self contacts break a route whatever the others do. */
function routeBrokenAlone(route: LayoutRelation, context: RoutingContext): boolean {
	if (routeHitsObstacles(route.points, context.nodes)) return true;
	const groups = foreignGroupObstacles(context, route, 0);
	if (groups !== undefined && routeHitsObstacles(route.points, groups)) return true;
	if (attachmentReservedBy(context, route, context.routes.keys())) return true;
	return !validateSelfContacts(route);
}

function repairRoute(context: RoutingContext, route: LayoutRelation): LayoutRelation | undefined {
	// A target can sit only 24px beyond a foreign frame. Preserve physical
	// disjointness when the preferred 24px envelope cannot fit at its face.
	context.refusedPaths.clear();
	for (const offsets of faceOffsetWindows(context, route))
		for (const clearance of [RAIL_SPACING, 0]) {
			const groups = foreignGroupObstacles(context, route, clearance);
			const replacement =
				alternateRoute(context, route, groups, offsets) ??
				aroundRoute(context, route, groups, offsets);
			if (replacement !== undefined) return replacement;
		}
	return undefined;
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
	// Release the routes needing repair together, then reserve each accepted replacement before
	// repairing the next one.
	const repairs = releasedRoutes(
		context,
		(route) => routeBrokenAlone(route, context),
		(route) => contactsAnotherRoute(route, context),
	);
	releaseSharedPortFamilies(context, repairs);
	const deferred = new Set<number>();
	for (const index of repairs) {
		const route = defined(routes[index]);
		context.activeIndex = index;
		context.pending.delete(index);
		const replacement = repairRoute(context, route);
		if (replacement === undefined) {
			// Pending routes reserve their attachments, yet group attachments may move during their
			// own repair: retry a blocked route once, after them.
			if (context.pending.size === 0 || deferred.has(index)) throw new GroupRouteFailure(route.id);
			deferred.add(index);
			context.pending.add(index);
			repairs.push(index);
			continue;
		}
		routes[index] = replacement;
		replaceRouteEnvelope(context.contactIndex, index, routePathBounds(replacement));
		for (const point of replacement.points)
			context.outside = Math.max(context.outside, transverse(point, frame.vertical));
	}
}
