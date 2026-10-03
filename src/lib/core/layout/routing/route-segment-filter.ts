import { defined } from '../../document/logic-document';
import { pointOnAxes } from '../geometry/layout-frame';
import type { Point } from '../layout-types';
import { main } from './group-exterior-path';
import type { RoutingContext } from './group-route-candidates';
import { type RouteObstacles, segmentHitsObstacles } from './route-obstacles';

export type SegmentFilter = (from: Point, to: Point) => boolean;

export const CLEAR = -1;

/**
 * The geometric checks of an admissible path hold for a path exactly when they hold for each of
 * its segments: coordinates, external flow (`sign`, see `externalFlowSign`), nodes and foreign
 * frames. Searches decide each segment once for every candidate sharing it.
 */
export function segmentFilter(
	context: RoutingContext,
	groups: RouteObstacles | undefined,
	sign: number,
): SegmentFilter {
	return (from, to) => {
		if (Math.min(from.x, from.y, to.x, to.y) < 0) return false;
		if ((main(to, context.vertical) - main(from, context.vertical)) * sign < 0) return false;
		if (segmentHitsObstacles(from, to, context.nodes)) return false;
		return groups === undefined || !segmentHitsObstacles(from, to, groups);
	};
}

/** The first blocked segment among those from `first` to the one before `end`. */
export function firstBlockedSegment(
	points: readonly Point[],
	clear: SegmentFilter,
	first: number,
	end: number,
): number {
	for (let index = first; index < end; index += 1)
		if (!clear(defined(points[index]), defined(points[index + 1]))) return index;
	return CLEAR;
}

/**
 * Verdicts of the transverse segments joining a port column to a track, by main coordinate,
 * column, then track. Every pair of ports of a face shares its main coordinates, so one source
 * port meets each track at the same clearances whatever the target port, and conversely.
 */
export interface TransverseSegments {
	readonly vertical: boolean;
	readonly clear: SegmentFilter;
	readonly verdicts: Map<number, Map<number, Map<number, boolean>>>;
}

export function transverseSegments(
	context: RoutingContext,
	groups: RouteObstacles | undefined,
): TransverseSegments {
	// A transverse segment never moves along the main axis: the external flow cannot refuse it.
	return {
		vertical: context.vertical,
		clear: segmentFilter(context, groups, 0),
		verdicts: new Map(),
	};
}

/** Whether the transverse segment at main coordinate `at` from `column` to `track` is clear. */
export function transverseClear(
	segments: TransverseSegments,
	at: number,
	column: number,
	track: number,
): boolean {
	let byColumn = segments.verdicts.get(at);
	if (byColumn === undefined) {
		byColumn = new Map();
		segments.verdicts.set(at, byColumn);
	}
	let byTrack = byColumn.get(column);
	if (byTrack === undefined) {
		byTrack = new Map();
		byColumn.set(column, byTrack);
	}
	let verdict = byTrack.get(track);
	if (verdict === undefined) {
		const { vertical } = segments;
		verdict = segments.clear(pointOnAxes(column, at, vertical), pointOnAxes(track, at, vertical));
		byTrack.set(track, verdict);
	}
	return verdict;
}
