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
import { exteriorMainRails, transverse } from './routing/group-exterior-path';
import { foreignGroupObstacles } from './routing/group-passages';
import {
	attachmentReservedBy,
	candidateFacePorts,
	endpoint,
	faceOffsetWindows,
	prepareRoutingContext,
	releasedRoutes,
	releaseSharedPortFamilies,
	type RoutingContext,
} from './routing/group-route-candidates';
import { prepareGroupTrackIndex } from './routing/group-track-index';
import {
	aroundForPorts,
	exteriorTrackSearch,
	pathForPorts,
	pathOnTrack,
	type TrackAttempt,
} from './routing/group-track-routes';
import { replaceRouteEnvelope, routeEnvelopeNeighbors } from './routing/route-envelope-index';
import { routeHitsObstacles } from './routing/route-obstacles';
import { transverseSegments } from './routing/route-segment-filter';

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

/** Use a second exterior axis only after every simpler passage has failed. */
function aroundRoute(
	context: RoutingContext,
	attempt: TrackAttempt,
	offsets: readonly number[],
): LayoutRelation | undefined {
	context.tracks ??= prepareGroupTrackIndex(context.bounds, context.vertical);
	const rails = exteriorMainRails(context.bounds, context.routes, context.vertical);
	const admits = (path: LayoutRelation): boolean => reservationsAdmit(context, path);
	for (const ports of candidateFacePorts(context, attempt.route, offsets)) {
		const exterior = { ...attempt, ports, rails };
		const candidate =
			aroundForPorts(context, exterior, admits) ?? boundaryForPorts(context, exterior, admits);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

function alternateRoute(
	context: RoutingContext,
	attempt: TrackAttempt,
	offsets: readonly number[],
): LayoutRelation | undefined {
	const admits = (path: LayoutRelation): boolean => reservationsAdmit(context, path);
	for (const ports of candidateFacePorts(context, attempt.route, offsets)) {
		const candidate = pathForPorts(exteriorTrackSearch(context, attempt, ports, admits));
		if (candidate !== undefined) return candidate;
	}
	// Beyond every current box and route, every next track is a fresh exterior rail.
	for (const ports of candidateFacePorts(context, attempt.route, offsets)) {
		const search = exteriorTrackSearch(context, attempt, ports, admits);
		for (let index = 1; index <= context.routes.length + 1; index += 1) {
			const candidate = pathOnTrack(search, context.outside + index * RAIL_SPACING);
			if (candidate !== undefined) return candidate;
		}
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
	context.refusedPaths.clear();
	// A target can sit only 24px beyond a foreign frame. Preserve physical
	// disjointness when the preferred 24px envelope cannot fit at its face.
	const attempts = [RAIL_SPACING, 0].map((clearance): TrackAttempt => {
		const groups = foreignGroupObstacles(context, route, clearance);
		return { route, groups, segments: transverseSegments(context, groups) };
	});
	for (const offsets of faceOffsetWindows(context, route))
		for (const attempt of attempts) {
			const replacement =
				alternateRoute(context, attempt, offsets) ?? aroundRoute(context, attempt, offsets);
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
