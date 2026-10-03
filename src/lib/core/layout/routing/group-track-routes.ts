import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { LayoutRelation, Point } from '../layout-types';
import {
	aroundPath,
	exteriorPath,
	faceClearances,
	type FacePorts,
	transverse,
} from './group-exterior-path';
import {
	type ExteriorAttempt,
	externalFlowSign,
	type RouteAttempt,
	type RoutingContext,
} from './group-route-candidates';
import { candidateTracks, prepareGroupTrackIndex } from './group-track-index';
import {
	CLEAR,
	firstBlockedSegment,
	type SegmentFilter,
	segmentFilter,
	transverseClear,
	type TransverseSegments,
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

type ClearancePair = (typeof CLEARANCE_PAIRS)[number];

export type Admits = (candidate: LayoutRelation) => boolean;

/** A repair attempt with the transverse segment verdicts shared by all its pairs of ports. */
export interface TrackAttempt extends RouteAttempt {
	readonly segments: TransverseSegments;
}

/** A clearance pair and the main coordinates where its path leaves the source and joins the target. */
interface FaceEnd {
	readonly pair: ClearancePair;
	readonly source: number;
	readonly target: number;
}

/** The candidates of one pair of ports. */
export interface TrackSearch {
	readonly context: RoutingContext;
	readonly attempt: TrackAttempt;
	readonly ports: FacePorts;
	readonly columns: { readonly source: number; readonly target: number };
	readonly clear: SegmentFilter;
	/** The checks of an admissible path that do not split into segments. */
	readonly admits: Admits;
	/** The clearance pairs whose end segments are clear, in their order of preference. */
	readonly ends: readonly FaceEnd[];
}

function endsClear(points: readonly Point[], clear: SegmentFilter): boolean {
	const last = points.length - 2;
	if (firstBlockedSegment(points, clear, 0, 1) !== CLEAR) return false;
	return firstBlockedSegment(points, clear, last, last + 1) === CLEAR;
}

/**
 * The first and last segments of exterior and around paths join a port to its clearance: the
 * ports and the clearances decide them, whatever the track or rail, so they are checked once.
 */
function trackSearch(
	context: RoutingContext,
	attempt: TrackAttempt,
	ports: FacePorts,
	{
		admits,
		path,
	}: { readonly admits: Admits; readonly path: (pair: ClearancePair) => readonly Point[] },
): TrackSearch {
	const clear = segmentFilter(
		context,
		attempt.groups,
		externalFlowSign(context, attempt.route, ports),
	);
	const ends: FaceEnd[] = [];
	for (const pair of CLEARANCE_PAIRS) {
		if (!endsClear(path(pair), clear)) continue;
		const [source, target] = faceClearances(context.frame, ports, pair);
		ends.push({ pair, source, target });
	}
	const columns = {
		source: transverse(ports.source, context.vertical),
		target: transverse(ports.target, context.vertical),
	};
	return { context, attempt, ports, columns, clear, admits, ends };
}

export function exteriorTrackSearch(
	context: RoutingContext,
	attempt: TrackAttempt,
	ports: FacePorts,
	admits: Admits,
): TrackSearch {
	// The track does not reach the end segments: any value probes them.
	const path = (pair: ClearancePair): readonly Point[] =>
		exteriorPath(context.frame, 0, ports, pair);
	return trackSearch(context, attempt, ports, { admits, path });
}

/** Segments: port, source clearance, track twice, target clearance, port. */
export function pathOnTrack(search: TrackSearch, track: number): LayoutRelation | undefined {
	const { segments } = search.attempt;
	for (const end of search.ends) {
		if (!transverseClear(segments, end.source, search.columns.source, track)) continue;
		if (!transverseClear(segments, end.target, search.columns.target, track)) continue;
		const points = exteriorPath(search.context.frame, track, search.ports, end.pair);
		if (!search.clear(defined(points[2]), defined(points[3]))) continue;
		const candidate = { ...search.attempt.route, points };
		if (search.admits(candidate)) return candidate;
	}
	return undefined;
}

export function pathForPorts(search: TrackSearch): LayoutRelation | undefined {
	const { context } = search;
	context.tracks ??= prepareGroupTrackIndex(context.bounds, context.vertical);
	const { source, target } = search.columns;
	for (const track of candidateTracks(context.tracks, source, target)) {
		const candidate = pathOnTrack(search, track);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

/** Segments: port, source clearance, rail twice, target track, target clearance, port. */
function aroundOnRail(
	search: TrackSearch,
	rail: { readonly main: number; readonly target: number },
): LayoutRelation | undefined {
	const { segments } = search.attempt;
	for (const end of search.ends) {
		if (!transverseClear(segments, end.target, search.columns.target, rail.target)) continue;
		const points = aroundPath(search.context.frame, search.ports, rail, end.pair);
		if (!search.clear(defined(points[1]), defined(points[2]))) continue;
		if (!search.clear(defined(points[3]), defined(points[4]))) continue;
		const candidate = { ...search.attempt.route, points };
		if (search.admits(candidate)) return candidate;
	}
	return undefined;
}

function aroundOnTrack(
	search: TrackSearch,
	rails: readonly number[],
	targetTrack: number,
): LayoutRelation | undefined {
	for (const mainRail of rails) {
		// The rail joins the target track whatever the clearances.
		const { segments } = search.attempt;
		if (!transverseClear(segments, mainRail, search.columns.source, targetTrack)) continue;
		const candidate = aroundOnRail(search, { main: mainRail, target: targetTrack });
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}

export function aroundForPorts(
	context: RoutingContext,
	attempt: TrackAttempt & ExteriorAttempt,
	admits: Admits,
): LayoutRelation | undefined {
	const { ports } = attempt;
	// Neither the rail nor the track reaches the end segments: any values probe them.
	const probe = { main: 0, target: 0 };
	const path = (pair: ClearancePair): readonly Point[] =>
		aroundPath(context.frame, ports, probe, pair);
	const search = trackSearch(context, attempt, ports, { admits, path });
	const { source, target } = search.columns;
	for (const targetTrack of candidateTracks(defined(context.tracks), source, target)) {
		const candidate = aroundOnTrack(search, attempt.rails, targetTrack);
		if (candidate !== undefined) return candidate;
	}
	return undefined;
}
