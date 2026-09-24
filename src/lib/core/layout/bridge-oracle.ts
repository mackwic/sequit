import { compareCanonicalStrings } from '../canonical-string';
import { strictCrossing, strictlyBetween } from './geometry/strict-crossing';
import { BRIDGE_CLEARANCE, BRIDGE_RADIUS } from './layout-settings';
import type { Point } from './layout-types';

/** The route shape the oracle reads: a stable identity and orthogonal waypoints. */
export interface RoutedPath {
	readonly id: string;
	readonly points: readonly Point[];
}

/** The orientation of one route run, as the canvas draws it. */
export enum RouteOrientation {
	Horizontal = 'horizontal',
	Vertical = 'vertical',
}

/** One maximal collinear run of a route: what the canvas draws and what the oracle measures. */
export interface RouteRun {
	readonly pathId: string;
	readonly start: Point;
	readonly end: Point;
	readonly orientation: RouteOrientation;
}

/** A run read on its own axis: the fixed cross coordinate and the low and high extent. */
export interface RunInterval {
	readonly fixed: number;
	readonly low: number;
	readonly high: number;
}

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
}

/** The mutable state of one bridge analysis: the runs, the crossings and the arcs already placed. */
interface BridgeScan {
	readonly runs: readonly RouteRun[];
	readonly crossings: Map<string, RouteCrossing>;
	readonly carried: Map<RouteRun, Point[]>;
	readonly bridges: Map<string, LayoutBridge>;
}

/** Reads a run on the axis it extends along. */
export function runInterval(run: RouteRun): RunInterval {
	if (run.orientation === RouteOrientation.Vertical)
		return {
			fixed: run.start.x,
			low: Math.min(run.start.y, run.end.y),
			high: Math.max(run.start.y, run.end.y),
		};
	return {
		fixed: run.start.y,
		low: Math.min(run.start.x, run.end.x),
		high: Math.max(run.start.x, run.end.x),
	};
}

/** A collinear contiguous run going the same way as the previous one merges into it. */
function continuesRun(last: RouteRun, run: RouteRun): boolean {
	if (last.orientation !== run.orientation) return false;
	if (last.end.x !== run.start.x || last.end.y !== run.start.y) return false;
	const previousDirection =
		Math.sign(last.end.x - last.start.x) + Math.sign(last.end.y - last.start.y);
	const nextDirection = Math.sign(run.end.x - run.start.x) + Math.sign(run.end.y - run.start.y);
	return previousDirection === nextDirection;
}

/** Appends the run between two waypoints, merging a collinear continuation into the last run. */
function collectRun(runs: RouteRun[], pathId: string, start: Point, end: Point): void {
	const vertical = start.x === end.x && start.y !== end.y;
	const horizontal = start.y === end.y && start.x !== end.x;
	if (!vertical && !horizontal) return;
	let orientation = RouteOrientation.Horizontal;
	if (vertical) orientation = RouteOrientation.Vertical;
	const run: RouteRun = { pathId, start, end, orientation };
	const last = runs.at(-1);
	if (last !== undefined && continuesRun(last, run)) {
		runs.pop();
		runs.push({ ...run, start: last.start });
		return;
	}
	runs.push(run);
}

/** The maximal collinear runs of one route. A collinear intermediate point is never a bend. */
export function routeRuns(path: RoutedPath): readonly RouteRun[] {
	const runs: RouteRun[] = [];
	let start: Point | undefined;
	for (const end of path.points) {
		if (start !== undefined) collectRun(runs, path.id, start, end);
		start = end;
	}
	return runs;
}

/** A bridge needs BRIDGE_CLEARANCE beyond its radius from both ends, and from its neighbours. */
function canCarryBridge(
	run: RouteRun,
	point: Point,
	carried: ReadonlyMap<RouteRun, readonly Point[]>,
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
		let previousCoordinate = previous.y;
		if (run.orientation === RouteOrientation.Horizontal) previousCoordinate = previous.x;
		const separation = Math.abs(previousCoordinate - coordinate);
		return separation === 0 || separation >= diameter;
	});
}

/** Every run parallel to `run` that passes through the point strictly inside itself. */
function overlappingCarriers(
	run: RouteRun,
	point: Point,
	runs: readonly RouteRun[],
): readonly RouteRun[] {
	return runs.filter((candidate) => {
		if (candidate.orientation !== run.orientation) return false;
		if (run.orientation === RouteOrientation.Horizontal)
			return (
				candidate.start.y === point.y &&
				strictlyBetween(point.x, candidate.start.x, candidate.end.x)
			);
		return (
			candidate.start.x === point.x && strictlyBetween(point.y, candidate.start.y, candidate.end.y)
		);
	});
}

function canonicalCrossingKey(crossing: RouteCrossing): string {
	return `${crossing.x}:${crossing.y}:${crossing.horizontalId}:${crossing.verticalId}`;
}

function canonicalBridgeKey(bridge: LayoutBridge): string {
	return `${bridge.x}:${bridge.y}:${bridge.carrierIds.join(',')}:${bridge.crossedIds.join(',')}`;
}

/**
 * Records the bridge of one strict crossing, if any run can carry it. The carrier orientation is
 * the one of the run the search reads second, and every run sharing that crossing carries the same
 * arc; the other orientation is crossed. A crossing whose two orientations are crowded stays a
 * bare crossing: the canvas draws it straight.
 */
function recordBridge(scan: BridgeScan, point: Point, current: RouteRun, previous: RouteRun): void {
	const groups = [current, previous].map((run) => overlappingCarriers(run, point, scan.runs));
	const taken = groups
		.flat()
		.some((run) =>
			(scan.carried.get(run) ?? []).some((placed) => placed.x === point.x && placed.y === point.y),
		);
	if (taken) return;
	const carriers = groups.find((group) =>
		group.every((run) => canCarryBridge(run, point, scan.carried)),
	);
	if (carriers === undefined) return;
	for (const carrier of carriers) {
		const points = scan.carried.get(carrier) ?? [];
		points.push(point);
		scan.carried.set(carrier, points);
	}
	const crossed = groups.filter((group) => group !== carriers).flat();
	const bridge: LayoutBridge = {
		...point,
		carrierIds: [...new Set(carriers.map(({ pathId }) => pathId))].sort(compareCanonicalStrings),
		crossedIds: [...new Set(crossed.map(({ pathId }) => pathId))].sort(compareCanonicalStrings),
	};
	scan.bridges.set(canonicalBridgeKey(bridge), bridge);
}

/** Reads one strict crossing of a run pair and records the bridge it can carry. */
function recordPairs(scan: BridgeScan, run: RouteRun, previousRuns: readonly RouteRun[]): void {
	for (const previous of previousRuns) {
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

/**
 * One pass over the declared routes: every strict crossing, and the bridges the canvas can draw
 * there. A bridge keeps `BRIDGE_RADIUS + BRIDGE_CLEARANCE` from every run end and twice the radius
 * plus the clearance from the next bridge on its carrier, which is exactly what the canvas draws.
 * The bridges are the derived mark shared by the rendering, the validators and the searches: no
 * layout result stores them.
 */
export function routeBridgeAnalysis(paths: readonly RoutedPath[]): RouteBridgeAnalysis {
	const runsByPath = paths.map((path) => routeRuns(path));
	const scan: BridgeScan = {
		runs: runsByPath.flat(),
		crossings: new Map(),
		carried: new Map(),
		bridges: new Map(),
	};
	const previousRuns: RouteRun[] = [];
	for (const pathRuns of runsByPath) {
		for (const run of pathRuns) recordPairs(scan, run, previousRuns);
		previousRuns.push(...pathRuns);
	}
	return {
		crossings: [...scan.crossings.values()].sort((left, right) => {
			const byPoint = left.x - right.x || left.y - right.y;
			if (byPoint !== 0) return byPoint;
			const byHorizontal = compareCanonicalStrings(left.horizontalId, right.horizontalId);
			if (byHorizontal !== 0) return byHorizontal;
			return compareCanonicalStrings(left.verticalId, right.verticalId);
		}),
		bridges: [...scan.bridges.values()].sort((left, right) => {
			const byPoint = left.x - right.x || left.y - right.y;
			if (byPoint !== 0) return byPoint;
			return compareCanonicalStrings(canonicalBridgeKey(left), canonicalBridgeKey(right));
		}),
	};
}

/** The strict crossings of the declared routes, in canonical order. */
export function strictCrossings(paths: readonly RoutedPath[]): readonly RouteCrossing[] {
	return routeBridgeAnalysis(paths).crossings;
}

/** The validated bridges of the declared routes, in canonical order: the derived bridge mark. */
export function validatedBridges(paths: readonly RoutedPath[]): readonly LayoutBridge[] {
	return routeBridgeAnalysis(paths).bridges;
}
