import { defined } from '../document/logic-document';
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

function chargeBridgeCoverage(bridge: LayoutBridge, charge: RouteWorkCharge | undefined): void {
	if (charge === undefined) return;
	const routeIds = bridge.carrierIds.length + bridge.crossedIds.length;
	charge(1 + 2 * routeIds);
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

/** The first bridge at or beyond one point in the oracle's x/y-sorted bridge array. */
function firstBridgeAtPoint(
	bridges: readonly LayoutBridge[],
	point: Point,
	charge?: RouteWorkCharge,
): number {
	let low = 0;
	let high = bridges.length;
	while (low < high) {
		charge?.(1);
		const middle = low + Math.floor((high - low) / 2);
		const bridge = defined(bridges[middle]);
		const beforeX = bridge.x < point.x;
		const beforeY = bridge.x === point.x && bridge.y < point.y;
		if (beforeX || beforeY) low = middle + 1;
		else high = middle;
	}
	return low;
}

export interface BridgeContactOptions {
	readonly charge?: RouteWorkCharge | undefined;
	/** The canonical x/y order returned by `validatedBridges` is guaranteed. */
	readonly sortedByPoint: true;
}

interface BridgeContactLookup {
	readonly bridges: readonly LayoutBridge[];
	readonly firstId: string;
	readonly secondId: string;
	readonly charge: RouteWorkCharge | undefined;
	readonly sortedByPoint: boolean;
}

function contactIsBridged(point: Point, lookup: BridgeContactLookup): boolean {
	const { bridges, firstId, secondId, charge, sortedByPoint } = lookup;
	let index = 0;
	if (sortedByPoint) index = firstBridgeAtPoint(bridges, point, charge);
	for (; index < bridges.length; index += 1) {
		const bridge = defined(bridges[index]);
		if (sortedByPoint && !samePoint(bridge, point)) break;
		chargeBridgeCoverage(bridge, charge);
		if (bridgeCovers(bridge, point, firstId, secondId)) return true;
	}
	return false;
}

/**
 * The contacts between two declared paths that no validated bridge covers. Empty exactly when
 * every contact of the pair is a strict crossing carried by a bridge of `bridges`, which is the
 * composition acceptance rule for two routes owned by the same region. A T-contact or a collinear
 * overlap is never covered. The indexed option requires the order of `validatedBridges`.
 */
export function unbridgedContacts(
	first: RoutedPath,
	second: RoutedPath,
	bridges: readonly LayoutBridge[],
	options?: BridgeContactOptions,
): readonly Point[] {
	const charge = options?.charge;
	const sortedByPoint = options?.sortedByPoint ?? false;
	const lookup = { bridges, firstId: first.id, secondId: second.id, charge, sortedByPoint };
	const contacts = new Map<string, Point>();
	const secondRuns = routeRuns(second, charge);
	for (const firstRun of routeRuns(first, charge)) {
		for (const secondRun of secondRuns) {
			charge?.(1);
			const point = runContact(firstRun, secondRun);
			if (point === undefined) continue;
			if (!contactIsBridged(point, lookup)) contacts.set(`${point.x}:${point.y}`, point);
		}
	}
	return [...contacts.values()];
}
