import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import { strictCrossing, strictlyBetween } from '../geometry/strict-crossing';
import { BRIDGE_CLEARANCE, BRIDGE_RADIUS } from '../layout-settings';
import type { Point } from '../layout-types';
import { type IndexedRun, indexRouteRuns, RunNeighborDirection } from './route-run-index';
import {
	type RoutedPath,
	RouteOrientation,
	type RouteRun,
	routeRuns,
	type RouteWorkCharge,
	runInterval,
} from './route-runs';

/** A strict perpendicular crossing: interior to both runs, so never a port, a bend or a portal. */
export interface RouteCrossing extends Point {
	readonly horizontalId: string;
	readonly verticalId: string;
}

/**
 * A validated bridge: the canvas draws one arc at `point` on every carrier route, which passes
 * over every crossed route. A collinear overlap and a T-contact are never bridges.
 */
export interface LayoutBridge extends Point {
	readonly carrierIds: readonly string[];
	readonly crossedIds: readonly string[];
}

export interface RouteBridgeAnalysis {
	readonly crossings: readonly RouteCrossing[];
	readonly bridges: readonly LayoutBridge[];
	readonly inspectedRuns: number;
}

/** Derived bridges tied to one immutable route array; a different candidate replaces them. */
export interface RouteBridgeCache {
	paths?: readonly RoutedPath[];
	bridges?: readonly LayoutBridge[];
}

/** The mutable state of one bridge analysis: the runs, the crossings and the arcs already placed. */
interface BridgeScan {
	readonly runsByPath: readonly (readonly RouteRun[])[];
	readonly crossings: Map<string, RouteCrossing>;
	readonly carried: Map<RouteRun, Point[]>;
	readonly bridges: Map<string, LayoutBridge>;
	carrierRuns?: {
		readonly horizontal: ReadonlyMap<number, readonly RouteRun[]>;
		readonly vertical: ReadonlyMap<number, readonly RouteRun[]>;
	};
	readonly charge?: RouteWorkCharge | undefined;
}

/** A bridge needs BRIDGE_CLEARANCE beyond its radius from both ends, and from its neighbours. */
function canCarryBridge(
	run: RouteRun,
	point: Point,
	carried: ReadonlyMap<RouteRun, readonly Point[]>,
	charge?: RouteWorkCharge,
): boolean {
	const interval = runInterval(run);
	let coordinate = point.y;
	if (run.orientation === RouteOrientation.Horizontal) coordinate = point.x;
	const minimum = BRIDGE_RADIUS + BRIDGE_CLEARANCE;
	const distance = coordinate - interval.low;
	const remaining = interval.high - coordinate;
	if (distance < minimum || remaining < minimum) return false;
	const diameter = BRIDGE_RADIUS * 2 + BRIDGE_CLEARANCE;
	return (carried.get(run) ?? []).every((previous) => {
		charge?.(1);
		let previousCoordinate = previous.y;
		if (run.orientation === RouteOrientation.Horizontal) previousCoordinate = previous.x;
		const separation = Math.abs(previousCoordinate - coordinate);
		return separation === 0 || separation >= diameter;
	});
}

/** Build carrier buckets only when a strict crossing makes them useful. */
function carrierRuns(scan: BridgeScan): NonNullable<BridgeScan['carrierRuns']> {
	if (scan.carrierRuns !== undefined) return scan.carrierRuns;
	const horizontal = new Map<number, RouteRun[]>();
	const vertical = new Map<number, RouteRun[]>();
	for (const pathRuns of scan.runsByPath)
		for (const run of pathRuns) {
			scan.charge?.(1);
			const isHorizontal = run.orientation === RouteOrientation.Horizontal;
			let buckets = vertical;
			let fixed = run.start.x;
			if (isHorizontal) {
				buckets = horizontal;
				fixed = run.start.y;
			}
			let group = buckets.get(fixed);
			if (group === undefined) {
				group = [];
				buckets.set(fixed, group);
			}
			group.push(run);
		}
	scan.carrierRuns = { horizontal, vertical };
	return scan.carrierRuns;
}

/** Every collinear run through a crossing point, in the original canonical run order. */
function overlappingCarriers(
	run: RouteRun,
	point: Point,
	index: NonNullable<BridgeScan['carrierRuns']>,
	charge?: RouteWorkCharge,
): readonly RouteRun[] {
	const horizontal = run.orientation === RouteOrientation.Horizontal;
	// A strict crossing lies inside both source runs, so its coordinate has a carrier bucket.
	let runs = index.vertical.get(point.x);
	if (horizontal) runs = index.horizontal.get(point.y);
	return defined(runs).filter((candidate) => {
		charge?.(1);
		if (horizontal) return strictlyBetween(point.x, candidate.start.x, candidate.end.x);
		return strictlyBetween(point.y, candidate.start.y, candidate.end.y);
	});
}

function canonicalCrossingKey(crossing: RouteCrossing): string {
	return `${crossing.x}:${crossing.y}:${crossing.horizontalId}:${crossing.verticalId}`;
}

function canonicalBridgeKey(bridge: LayoutBridge): string {
	return `${bridge.x}:${bridge.y}:${bridge.carrierIds.join(',')}:${bridge.crossedIds.join(',')}`;
}

/**
 * Records one strict crossing's bridge, preferring the current run's orientation before the
 * previous run's. Point-sequence scan order makes the choice independent of ids and input order.
 */
function recordBridge(scan: BridgeScan, point: Point, current: RouteRun, previous: RouteRun): void {
	const { charge } = scan;
	let groupSize = 0;
	const index = carrierRuns(scan);
	const groups = [current, previous].map((run) => {
		const group = overlappingCarriers(run, point, index, charge);
		if (charge !== undefined) groupSize += group.length;
		return group;
	});
	charge?.(groupSize);
	const taken = groups.flat().some((run) => {
		charge?.(1);
		return (scan.carried.get(run) ?? []).some((placed) => {
			charge?.(1);
			return placed.x === point.x && placed.y === point.y;
		});
	});
	if (taken) return;
	const carriers = groups.find((group) =>
		group.every((run) => {
			charge?.(1);
			return canCarryBridge(run, point, scan.carried, charge);
		}),
	);
	if (carriers === undefined) return;
	for (const carrier of carriers) {
		const points = scan.carried.get(carrier) ?? [];
		points.push(point);
		scan.carried.set(carrier, points);
	}
	const crossed = groups.filter((group) => group !== carriers).flat();
	charge?.(carriers.length + crossed.length);
	const bridge: LayoutBridge = {
		...point,
		carrierIds: [...new Set(carriers.map(({ pathId }) => pathId))].sort((left, right) => {
			charge?.(1);
			return compareCanonicalStrings(left, right);
		}),
		crossedIds: [...new Set(crossed.map(({ pathId }) => pathId))].sort((left, right) => {
			charge?.(1);
			return compareCanonicalStrings(left, right);
		}),
	};
	scan.bridges.set(canonicalBridgeKey(bridge), bridge);
}

/** Reads one strict crossing of a run pair and records the bridge it can carry. */
function recordPairs(
	scan: BridgeScan,
	run: RouteRun,
	previousRuns: readonly IndexedRun[],
	charge?: RouteWorkCharge,
): void {
	for (const { run: previous } of previousRuns) {
		charge?.(1);
		const point = strictCrossing(run.start, run.end, previous.start, previous.end);
		if (point === undefined) continue;
		let horizontal = previous;
		let vertical = run;
		if (run.orientation === RouteOrientation.Horizontal) {
			horizontal = run;
			vertical = previous;
		}
		const crossing: RouteCrossing = {
			...point,
			horizontalId: horizontal.pathId,
			verticalId: vertical.pathId,
		};
		scan.crossings.set(canonicalCrossingKey(crossing), crossing);
		recordBridge(scan, point, run, previous);
	}
}

/** Route ids are only a tie-break when the complete geometric paths are identical. */
function compareRouteGeometry(
	left: RoutedPath,
	right: RoutedPath,
	charge?: RouteWorkCharge,
): number {
	const sharedLength = Math.min(left.points.length, right.points.length);
	for (let index = 0; index < sharedLength; index += 1) {
		charge?.(1);
		const leftPoint = defined(left.points[index]);
		const rightPoint = defined(right.points[index]);
		const byX = leftPoint.x - rightPoint.x;
		if (byX !== 0) return byX;
		const byY = leftPoint.y - rightPoint.y;
		if (byY !== 0) return byY;
	}
	const byLength = left.points.length - right.points.length;
	if (byLength !== 0) return byLength;
	return compareCanonicalStrings(left.id, right.id);
}

/**
 * One pass over routes in canonical point-sequence order: every strict crossing, and the bridges
 * the canvas can draw there. A bridge keeps `BRIDGE_RADIUS + BRIDGE_CLEARANCE` from every run end
 * and twice the radius plus the clearance from the next bridge on its carrier, which is exactly
 * what the canvas draws. The bridges are the derived mark shared by rendering, validators and
 * searches: no layout result stores them.
 */
export function routeBridgeAnalysis(
	paths: readonly RoutedPath[],
	charge?: RouteWorkCharge,
): RouteBridgeAnalysis {
	const sortedPaths = [...paths].sort((left, right) => {
		charge?.(1);
		return compareRouteGeometry(left, right, charge);
	});
	const runsByPath = sortedPaths.map((path) => routeRuns(path, charge));
	const scan: BridgeScan = {
		runsByPath,
		crossings: new Map(),
		carried: new Map(),
		bridges: new Map(),
		charge,
	};
	const runs: RouteRun[] = [];
	const pathOrdinals: number[] = [];
	for (const [pathIndex, pathRuns] of runsByPath.entries())
		for (const run of pathRuns) {
			runs.push(run);
			pathOrdinals.push(pathIndex);
		}
	const indexed = indexRouteRuns(runs, {
		direction: RunNeighborDirection.Earlier,
		perpendicularOnly: true,
		charge,
		pathOrdinals,
	});
	let runIndex = 0;
	for (const pathRuns of runsByPath) {
		for (const run of pathRuns) {
			recordPairs(scan, run, indexed(runIndex), charge);
			runIndex += 1;
		}
	}
	return {
		inspectedRuns: runs.length,
		crossings: [...scan.crossings.values()].sort((left, right) => {
			charge?.(1);
			const byPoint = left.x - right.x || left.y - right.y;
			if (byPoint !== 0) return byPoint;
			const byHorizontal = compareCanonicalStrings(left.horizontalId, right.horizontalId);
			if (byHorizontal !== 0) return byHorizontal;
			return compareCanonicalStrings(left.verticalId, right.verticalId);
		}),
		bridges: [...scan.bridges.values()].sort((left, right) => {
			charge?.(1);
			const byPoint = left.x - right.x || left.y - right.y;
			if (byPoint !== 0) return byPoint;
			return compareCanonicalStrings(canonicalBridgeKey(left), canonicalBridgeKey(right));
		}),
	};
}

/** The validated bridges of the declared routes, in canonical order: the derived bridge mark. */
export function validatedBridges(
	paths: readonly RoutedPath[],
	charge?: RouteWorkCharge,
): readonly LayoutBridge[] {
	return routeBridgeAnalysis(paths, charge).bridges;
}

/** Share one derived bridge analysis between validators of the same assembled candidate. */
export function validatedBridgesCached(
	paths: readonly RoutedPath[],
	cache?: RouteBridgeCache,
): readonly LayoutBridge[] {
	const previous = cache?.bridges;
	if (previous !== undefined && cache?.paths === paths) return previous;
	const bridges = validatedBridges(paths);
	if (cache !== undefined) {
		cache.paths = paths;
		cache.bridges = bridges;
	}
	return bridges;
}
