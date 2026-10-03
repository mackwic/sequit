import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { LayoutRelation, Point } from '../layout-types';
import { aroundPath, exteriorPath, type FacePorts, transverse } from './group-exterior-path';
import type { ExteriorAttempt, RouteAttempt, RoutingContext } from './group-route-candidates';
import { candidateTracks, prepareGroupTrackIndex } from './group-track-index';
import {
	CLEAR,
	firstBlockedSegment,
	type SegmentFilter,
	segmentFilter,
} from './route-segment-filter';

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
// The first and last segments of exterior and around paths join a port to its clearance: the
// ports and the clearances decide them, whatever the track or rail. The third segment of an
// around path joins its rail to the target track whatever the clearances.
const AROUND_RAIL_SEGMENT = 2;

type ClearancePair = (typeof CLEARANCE_PAIRS)[number];

export type Admits = (candidate: LayoutRelation) => boolean;

/** The candidates of one pair of ports. */
export interface TrackSearch {
	readonly context: RoutingContext;
	readonly attempt: RouteAttempt;
	readonly ports: FacePorts;
	readonly clear: SegmentFilter;
	/** The checks of an admissible path that do not split into segments. */
	readonly admits: Admits;
	/** The clearance pairs whose end segments are clear, in their order of preference. */
	readonly clearances: readonly ClearancePair[];
}

function endsClear(points: readonly Point[], clear: SegmentFilter): boolean {
	const last = points.length - 2;
	if (firstBlockedSegment(points, clear, 0, 1) !== CLEAR) return false;
	return firstBlockedSegment(points, clear, last, last + 1) === CLEAR;
}

export function exteriorTrackSearch(
	context: RoutingContext,
	attempt: RouteAttempt,
	ports: FacePorts,
	admits: Admits,
): TrackSearch {
	const clear = segmentFilter(context, attempt, ports);
	// The track does not reach the end segments: any value probes them.
	const clearances = CLEARANCE_PAIRS.filter((pair) =>
		endsClear(exteriorPath(context.frame, 0, ports, pair), clear),
	);
	return { context, attempt, ports, clear, admits, clearances };
}

export function pathOnTrack(search: TrackSearch, track: number): LayoutRelation | undefined {
	for (const clearances of search.clearances) {
		const points = exteriorPath(search.context.frame, track, search.ports, clearances);
		if (firstBlockedSegment(points, search.clear, 1, points.length - 2) !== CLEAR) continue;
		const candidate = { ...search.attempt.route, points };
		if (search.admits(candidate)) return candidate;
	}
	return undefined;
}

export function pathForPorts(search: TrackSearch): LayoutRelation | undefined {
	const { context, ports } = search;
	context.tracks ??= prepareGroupTrackIndex(context.bounds, context.vertical);
	const source = transverse(ports.source, context.vertical);
	const target = transverse(ports.target, context.vertical);
	for (const track of candidateTracks(context.tracks, source, target)) {
		const candidate = pathOnTrack(search, track);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

function aroundOnTrack(
	search: TrackSearch,
	rails: readonly number[],
	targetTrack: number,
): LayoutRelation | undefined {
	for (const mainRail of rails) {
		const rail = { main: mainRail, target: targetTrack };
		for (const clearances of search.clearances) {
			const points = aroundPath(search.context.frame, search.ports, rail, clearances);
			const blocked = firstBlockedSegment(points, search.clear, 1, points.length - 2);
			if (blocked === AROUND_RAIL_SEGMENT) break;
			if (blocked !== CLEAR) continue;
			const candidate = { ...search.attempt.route, points };
			if (search.admits(candidate)) return candidate;
		}
	}
	return undefined;
}

export function aroundForPorts(
	context: RoutingContext,
	attempt: ExteriorAttempt,
	admits: Admits,
): LayoutRelation | undefined {
	const { ports } = attempt;
	const clear = segmentFilter(context, attempt, ports);
	// Neither the rail nor the track reaches the end segments: any values probe them.
	const probe = { main: 0, target: 0 };
	const clearances = CLEARANCE_PAIRS.filter((pair) =>
		endsClear(aroundPath(context.frame, ports, probe, pair), clear),
	);
	const search = { context, attempt, ports, clear, admits, clearances };
	const source = transverse(ports.source, context.vertical);
	const target = transverse(ports.target, context.vertical);
	for (const targetTrack of candidateTracks(defined(context.tracks), source, target)) {
		const candidate = aroundOnTrack(search, attempt.rails, targetTrack);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}
