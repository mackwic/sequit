import {
	type LayoutBridge,
	type RouteBridgeAnalysis,
	type RouteCrossing,
	type RoutedPath,
	RouteOrientation,
	type RouteRun,
	routeRuns,
	type RouteWorkCharge,
	runInterval,
} from './bridge-oracle';
import type { Point } from './layout-types';
import { samePoint } from './nested-region-geometry-primitives';

/** True when a validated bridge carries the contact point between the two declared paths. */
function bridgeCovers(
	bridge: LayoutBridge,
	point: Point,
	firstId: string,
	secondId: string,
): boolean {
	if (!samePoint(bridge, point)) return false;
	const forward = bridge.carrierIds.includes(firstId) && bridge.crossedIds.includes(secondId);
	const backward = bridge.carrierIds.includes(secondId) && bridge.crossedIds.includes(firstId);
	return forward || backward;
}

/** The crossings of an analysis that no validated bridge of the same analysis covers. */
export function unbridgedCrossings(analysis: RouteBridgeAnalysis): readonly RouteCrossing[] {
	return analysis.crossings.filter(
		(crossing) =>
			!analysis.bridges.some((bridge) =>
				bridgeCovers(bridge, crossing, crossing.horizontalId, crossing.verticalId),
			),
	);
}

/**
 * The contact point of one pair of runs, or `undefined` when the two runs do not touch. The test is
 * the conservative composition contact: collinear overlap, T-contact and perpendicular touch all
 * count, endpoints included.
 */
function runContact(first: RouteRun, second: RouteRun): Point | undefined {
	const left = runInterval(first);
	const right = runInterval(second);
	if (first.orientation === second.orientation) {
		if (left.fixed !== right.fixed) return undefined;
		const low = Math.max(left.low, right.low);
		const high = Math.min(left.high, right.high);
		if (low > high) return undefined;
		if (first.orientation === RouteOrientation.Vertical) return { x: left.fixed, y: low };
		return { x: low, y: left.fixed };
	}
	const firstInside = right.fixed >= left.low && right.fixed <= left.high;
	const secondInside = left.fixed >= right.low && left.fixed <= right.high;
	if (!firstInside || !secondInside) return undefined;
	if (first.orientation === RouteOrientation.Vertical) return { x: left.fixed, y: right.fixed };
	return { x: right.fixed, y: left.fixed };
}

/**
 * The contacts between two declared paths that no validated bridge covers. Empty exactly when
 * every contact of the pair is a strict crossing carried by a bridge of `bridges`, which is the
 * composition acceptance rule for two routes owned by the same region. A T-contact or a collinear
 * overlap is never covered.
 */
export function unbridgedContacts(
	first: RoutedPath,
	second: RoutedPath,
	bridges: readonly LayoutBridge[],
	charge?: RouteWorkCharge,
): readonly Point[] {
	const contacts = new Map<string, Point>();
	const secondRuns = routeRuns(second, charge);
	for (const firstRun of routeRuns(first, charge)) {
		for (const secondRun of secondRuns) {
			charge?.(1);
			const point = runContact(firstRun, secondRun);
			if (point === undefined) continue;
			const covered = bridges.some((bridge) => {
				const routeIds = bridge.carrierIds.length + bridge.crossedIds.length;
				charge?.(1 + 2 * routeIds);
				return bridgeCovers(bridge, point, first.id, second.id);
			});
			if (!covered) contacts.set(`${point.x}:${point.y}`, point);
		}
	}
	return [...contacts.values()];
}
