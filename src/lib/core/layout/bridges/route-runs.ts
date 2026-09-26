import type { Point } from '../layout-types';

/** Optional elementary geometry-work charge for bounded route searches. */
export type RouteWorkCharge = (units: number) => void;

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
interface RunInterval {
	readonly fixed: number;
	readonly low: number;
	readonly high: number;
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
export function routeRuns(path: RoutedPath, charge?: RouteWorkCharge): readonly RouteRun[] {
	const runs: RouteRun[] = [];
	let start: Point | undefined;
	for (const end of path.points) {
		charge?.(1);
		if (start !== undefined) collectRun(runs, path.id, start, end);
		start = end;
	}
	return runs;
}
