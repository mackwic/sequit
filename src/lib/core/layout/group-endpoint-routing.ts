import { defined, EndpointKind } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { disallowedRouteContacts } from './bridges/bridge-contact';
import { routeBridgeAnalysis } from './bridges/bridge-oracle';
import { validateSelfContacts } from './bridges/route-self-contacts';
import { routePathBounds } from './geometry/box-geometry';
import type { LayoutFrame } from './geometry/layout-frame';
import { PORT_SPACING, RAIL_SPACING } from './layout-settings';
import { type Bounds, GroupRouteFailure, type LayoutRelation } from './layout-types';
import {
	aroundBoundaryPath,
	aroundPath,
	exteriorMainRails,
	exteriorPath,
	type FacePorts,
	sourceBoundaryEscapes,
	transverse,
} from './routing/group-exterior-path';
import { foreignGroupObstacles } from './routing/group-passages';
import {
	prepareRoutingContext,
	respectsExternalFlow,
	type RoutingContext,
	shiftedGroupPort,
} from './routing/group-route-candidates';
import { candidateTracks, prepareGroupTrackIndex } from './routing/group-track-index';
import { replaceRouteEnvelope, routeEnvelopeNeighbors } from './routing/route-envelope-index';
import { routeHitsObstacles, type RouteObstacles } from './routing/route-obstacles';

const HALF_RAIL = RAIL_SPACING / 2;
const PORT_OFFSETS = [
	0,
	PORT_SPACING,
	-PORT_SPACING,
	RAIL_SPACING,
	-RAIL_SPACING,
	HALF_RAIL,
	-HALF_RAIL,
];
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

interface RouteAttempt {
	readonly route: LayoutRelation;
	readonly groups: RouteObstacles | undefined;
}
interface ExteriorAttempt extends RouteAttempt {
	readonly ports: FacePorts;
	readonly rails: readonly number[];
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
	if (!respectsExternalFlow(context, candidate)) return false;
	if (routeHitsObstacles(candidate.points, context.nodes)) return false;
	if (groups !== undefined && routeHitsObstacles(candidate.points, groups)) return false;
	return !contactsAnotherRoute(candidate, context);
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

function boundaryOnTrack(
	context: RoutingContext,
	attempt: ExteriorAttempt,
	escape: readonly [number, number],
	targetTrack: number,
): LayoutRelation | undefined {
	for (const mainRail of attempt.rails) {
		const rails = {
			main: mainRail,
			sourceMain: escape[0],
			sourceTrack: escape[1],
			targetTrack,
		};
		for (const targetClearance of [RAIL_SPACING, DOUBLE_RAIL, TRIPLE_RAIL, HALF_RAIL]) {
			const points = aroundBoundaryPath(context.frame, attempt.ports, rails, targetClearance);
			const candidate = { ...attempt.route, points };
			if (admissiblePath(context, candidate, attempt.groups)) return candidate;
		}
	}
	return undefined;
}

function boundaryForPorts(
	context: RoutingContext,
	attempt: ExteriorAttempt,
): LayoutRelation | undefined {
	const escapes = sourceBoundaryEscapes(
		context.bounds,
		context.graph.document.groups,
		attempt.ports.source,
		context.frame,
	);
	const source = transverse(attempt.ports.source, context.vertical);
	const target = transverse(attempt.ports.target, context.vertical);
	for (const escape of escapes)
		for (const targetTrack of candidateTracks(defined(context.tracks), source, target)) {
			const candidate = boundaryOnTrack(context, attempt, escape, targetTrack);
			if (candidate !== undefined) return candidate;
		}
	return undefined;
}

/** Use a second exterior axis only after every simpler passage has failed. */
function aroundRoute(
	context: RoutingContext,
	route: LayoutRelation,
	groups: RouteObstacles | undefined,
): LayoutRelation | undefined {
	context.tracks ??= prepareGroupTrackIndex(context.bounds, context.vertical);
	const rails = exteriorMainRails(context.bounds, context.routes, context.vertical);
	for (const sourceOffset of PORT_OFFSETS) {
		const source = shiftedGroupPort(context, route, true, sourceOffset);
		if (source === undefined) continue;
		for (const targetOffset of PORT_OFFSETS) {
			const target = shiftedGroupPort(context, route, false, targetOffset);
			if (target === undefined) continue;
			const attempt = { route, groups, ports: { source, target }, rails };
			const candidate = aroundForPorts(context, attempt) ?? boundaryForPorts(context, attempt);
			if (candidate !== undefined) return candidate;
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
		const source = shiftedGroupPort(context, route, true, sourceOffset);
		if (source === undefined) continue;
		for (const targetOffset of PORT_OFFSETS) {
			const target = shiftedGroupPort(context, route, false, targetOffset);
			if (target === undefined) continue;
			const candidate = exteriorForPorts(context, attempt, { source, target });
			if (candidate !== undefined) return candidate;
		}
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
	for (const [index, route] of routes.entries()) {
		context.activeIndex = index;
		const groups = foreignGroupObstacles(context, route, 0);
		const hitsNode = routeHitsObstacles(route.points, context.nodes);
		const hitsGroup = groups !== undefined && routeHitsObstacles(route.points, groups);
		if (!hitsNode && !hitsGroup) continue;
		const clearanceGroups = foreignGroupObstacles(context, route);
		let replacement =
			alternateRoute(context, route, clearanceGroups) ??
			freshExterior(context, route, clearanceGroups) ??
			aroundRoute(context, route, clearanceGroups);
		if (replacement === undefined) {
			// A target can sit only 24px beyond a foreign frame. Preserve physical
			// disjointness when the preferred 24px envelope cannot fit at its face.
			const exactGroups = foreignGroupObstacles(context, route, 0);
			replacement =
				alternateRoute(context, route, exactGroups) ??
				freshExterior(context, route, exactGroups) ??
				aroundRoute(context, route, exactGroups);
		}
		if (replacement === undefined) throw new GroupRouteFailure(route.id);
		routes[index] = replacement;
		replaceRouteEnvelope(context.contactIndex, index, routePathBounds(replacement));
		for (const point of replacement.points)
			context.outside = Math.max(context.outside, transverse(point, frame.vertical));
	}
}
