import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { LayoutRelation, Point } from '../layout-types';
import { aroundBoundaryPath, main, sourceBoundaryEscapes, transverse } from './group-exterior-path';
import {
	type ExteriorAttempt,
	externalFlowSign,
	type RoutingContext,
	sharedSourceEscapes,
} from './group-route-candidates';
import { candidateTracks } from './group-track-index';
import { segmentHitsObstacles } from './route-obstacles';

const HALF_RAIL = RAIL_SPACING / 2;
const DOUBLE_RAIL = RAIL_SPACING * 2;
const TRIPLE_RAIL = RAIL_SPACING * 3;
const INWARD_TRIPLE_RAIL = -TRIPLE_RAIL;
const ESCAPE_CLEARANCES = [RAIL_SPACING, DOUBLE_RAIL, TRIPLE_RAIL, HALF_RAIL, 0];
const TARGET_CLEARANCES = [
	RAIL_SPACING,
	DOUBLE_RAIL,
	TRIPLE_RAIL,
	HALF_RAIL,
	-HALF_RAIL,
	-RAIL_SPACING,
	-DOUBLE_RAIL,
	INWARD_TRIPLE_RAIL,
];
// Segments of a boundary path: the first two depend on the escape alone, the third on the escape
// and the main rail, the fourth also on the target track; only the last three on the clearance.
const RAIL_SEGMENT = 2;
const TRACK_SEGMENT = 3;
const CLEAR = -1;

type SegmentFilter = (from: Point, to: Point) => boolean;

interface BoundarySearch {
	readonly context: RoutingContext;
	readonly attempt: ExteriorAttempt;
	readonly clear: SegmentFilter;
	/** The checks of an admissible path that do not split into segments. */
	readonly admits: (candidate: LayoutRelation) => boolean;
}

interface BoundaryRails {
	readonly main: number;
	readonly sourceMain: number;
	readonly sourceTrack: number;
	readonly targetTrack: number;
}

/**
 * The geometric checks of an admissible path hold for a path exactly when they hold for each of
 * its segments: coordinates, external flow, nodes and foreign frames.
 */
function exteriorSegmentFilter(context: RoutingContext, attempt: ExteriorAttempt): SegmentFilter {
	const sign = externalFlowSign(context, attempt.route, attempt.ports);
	const { groups } = attempt;
	return (from, to) => {
		if (Math.min(from.x, from.y, to.x, to.y) < 0) return false;
		if ((main(to, context.vertical) - main(from, context.vertical)) * sign < 0) return false;
		if (segmentHitsObstacles(from, to, context.nodes)) return false;
		return groups === undefined || !segmentHitsObstacles(from, to, groups);
	};
}

function firstBlockedSegment(points: readonly Point[], clear: SegmentFilter): number {
	for (let index = 1; index < points.length; index += 1)
		if (!clear(defined(points[index - 1]), defined(points[index]))) return index - 1;
	return CLEAR;
}

/** The candidate of the first admissible clearance, or the blocked segment shared by all. */
function boundaryOnRail(
	search: BoundarySearch,
	rails: BoundaryRails,
): LayoutRelation | number | undefined {
	for (const targetClearance of TARGET_CLEARANCES) {
		const points = aroundBoundaryPath(
			search.context.frame,
			search.attempt.ports,
			rails,
			targetClearance,
		);
		const blocked = firstBlockedSegment(points, search.clear);
		if (blocked !== CLEAR && blocked <= TRACK_SEGMENT) return blocked;
		if (blocked !== CLEAR) continue;
		const candidate = { ...search.attempt.route, points };
		if (search.admits(candidate)) return candidate;
	}
	return undefined;
}

/** Skip only the candidates that share a blocked segment with a rejected one. */
function boundaryOnEscape(
	search: BoundarySearch,
	escape: readonly [number, number],
): LayoutRelation | undefined {
	const { context, attempt } = search;
	const source = transverse(attempt.ports.source, context.vertical);
	const target = transverse(attempt.ports.target, context.vertical);
	const open = [...attempt.rails];
	for (const targetTrack of candidateTracks(defined(context.tracks), source, target)) {
		for (const mainRail of [...open]) {
			const rails = { main: mainRail, sourceMain: escape[0], sourceTrack: escape[1], targetTrack };
			const result = boundaryOnRail(search, rails);
			if (typeof result === 'object') return result;
			if (result !== undefined && result < RAIL_SEGMENT) return undefined;
			if (result === RAIL_SEGMENT) open.splice(open.indexOf(mainRail), 1);
		}
		if (open.length === 0) return undefined;
	}
	return undefined;
}

export function boundaryForPorts(
	context: RoutingContext,
	attempt: ExteriorAttempt,
	admits: (candidate: LayoutRelation) => boolean,
): LayoutRelation | undefined {
	const escapes = [
		...sourceBoundaryEscapes(
			context.bounds,
			context.graph.document.groups,
			attempt.ports.source,
			context.frame,
		),
		...sharedSourceEscapes(context, attempt.route, attempt.ports.source),
	];
	// A node can block the source column on the way to the exterior main rail.
	// Reserve a transverse escape first, instead of extending that column through it.
	let outgoing = 1;
	if (context.frame.forward) outgoing = -1;
	const sourceMain = main(attempt.ports.source, context.vertical);
	for (const clearance of ESCAPE_CLEARANCES)
		for (const track of [context.outside + RAIL_SPACING, 0])
			escapes.push([sourceMain + outgoing * clearance, track]);
	const search = { context, attempt, clear: exteriorSegmentFilter(context, attempt), admits };
	for (const escape of escapes) {
		const candidate = boundaryOnEscape(search, escape);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}
