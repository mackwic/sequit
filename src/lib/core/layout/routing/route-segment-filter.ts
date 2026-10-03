import { defined } from '../../document/logic-document';
import type { Point } from '../layout-types';
import { type FacePorts, main } from './group-exterior-path';
import { externalFlowSign, type RouteAttempt, type RoutingContext } from './group-route-candidates';
import { segmentHitsObstacles } from './route-obstacles';

export type SegmentFilter = (from: Point, to: Point) => boolean;

export const CLEAR = -1;

/**
 * The geometric checks of an admissible path hold for a path exactly when they hold for each of
 * its segments: coordinates, external flow, nodes and foreign frames. Searches decide each
 * segment once for every candidate sharing it.
 */
export function segmentFilter(
	context: RoutingContext,
	attempt: RouteAttempt,
	ports: FacePorts,
): SegmentFilter {
	const sign = externalFlowSign(context, attempt.route, ports);
	const { groups } = attempt;
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
