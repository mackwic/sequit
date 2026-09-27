import { defined } from '../../../../lib/core/document/logic-document';
import {
	type LayoutBridge,
	routeBridgeAnalysis,
	type RouteCrossing,
} from '../../../../lib/core/layout/bridges/bridge-oracle';
import {
	RouteOrientation,
	type RouteRun,
	routeRuns,
	runInterval,
} from '../../../../lib/core/layout/bridges/route-runs';
import { BRIDGE_CLEARANCE, BRIDGE_RADIUS } from '../../../../lib/core/layout/layout-settings';
import type { LayoutRelation, Point } from '../../projection/layout-graph';
import {
	PARALLEL_COLOR_DISTANCE,
	parallelSegmentsAreClose,
	relationColors,
} from './relation-colors';
import { DEFAULT_ROUTE_PALETTE, type RoutePalette } from './route-color-palette';

export interface RenderedRelation extends LayoutRelation {
	readonly path: string;
	readonly color: string;
}

interface ParallelRun {
	readonly run: RouteRun;
	readonly relationIndex: number;
	readonly fixed: number;
}

/** Runs of each orientation sorted by fixed coordinate: nearby parallels form one slice. */
type ParallelRuns = Readonly<Record<RouteOrientation, readonly ParallelRun[]>>;

function parallelRuns(runsByRelation: readonly (readonly RouteRun[])[]): ParallelRuns {
	const index: Record<RouteOrientation, ParallelRun[]> = {
		[RouteOrientation.Horizontal]: [],
		[RouteOrientation.Vertical]: [],
	};
	for (const [relationIndex, runs] of runsByRelation.entries())
		for (const run of runs)
			index[run.orientation].push({ run, relationIndex, fixed: runInterval(run).fixed });
	for (const runs of Object.values(index)) runs.sort((left, right) => left.fixed - right.fixed);
	return index;
}

/** Parallel runs whose fixed coordinate is at most `distance` from the run's own. */
function nearbyParallels(
	parallels: ParallelRuns,
	run: RouteRun,
	distance: number,
): readonly ParallelRun[] {
	const runs = parallels[run.orientation];
	const { fixed } = runInterval(run);
	let low = 0;
	let high = runs.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (defined(runs[middle]).fixed < fixed - distance) low = middle + 1;
		else high = middle;
	}
	const nearby: ParallelRun[] = [];
	for (let index = low; index < runs.length; index += 1) {
		const candidate = defined(runs[index]);
		if (candidate.fixed > fixed + distance) break;
		nearby.push(candidate);
	}
	return nearby;
}

function distanceAlong(run: RouteRun, point: Point): number {
	if (run.orientation === RouteOrientation.Horizontal) return Math.abs(point.x - run.start.x);
	return Math.abs(point.y - run.start.y);
}

function pointAlong(run: RouteRun, distance: number): Point {
	if (run.orientation === RouteOrientation.Horizontal)
		return {
			x: run.start.x + Math.sign(run.end.x - run.start.x) * distance,
			y: run.start.y,
		};
	return {
		x: run.start.x,
		y: run.start.y + Math.sign(run.end.y - run.start.y) * distance,
	};
}

/**
 * The visual side of a bridge: the bulge avoids a parallel trunk closer than the clearance. A
 * parallel at least that far away can decide neither side, so only nearby parallels are read.
 */
function bridgeSweep(run: RouteRun, point: Point, parallels: ParallelRuns): number {
	const horizontal = run.orientation === RouteOrientation.Horizontal;
	const axis = horizontal ? 'x' : 'y';
	const cross = horizontal ? 'y' : 'x';
	let side = Math.sign(run.end[axis] - run.start[axis]);
	if (horizontal) side = -side;
	const minimum = BRIDGE_RADIUS + BRIDGE_CLEARANCE;
	let current = Number.POSITIVE_INFINITY;
	let opposite = Number.POSITIVE_INFINITY;
	for (const { run: other } of nearbyParallels(parallels, run, minimum)) {
		const start = Math.min(other.start[axis], other.end[axis]);
		const end = Math.max(other.start[axis], other.end[axis]);
		const before = point[axis] - BRIDGE_RADIUS;
		const after = point[axis] + BRIDGE_RADIUS;
		if (end < before || start > after) continue;
		const offset = (other.start[cross] - point[cross]) * side;
		if (offset > 0) current = Math.min(current, offset);
		if (offset < 0) opposite = Math.min(opposite, -offset);
	}
	if (current < minimum && opposite > current) return 0;
	return 1;
}

function pathFor(
	runs: readonly RouteRun[],
	bridges: ReadonlyMap<RouteRun, readonly Point[]>,
	parallels: ParallelRuns,
): string {
	const first = runs.at(0);
	if (!first) return '';
	const commands = [`M ${first.start.x} ${first.start.y}`];
	let cursor = first.start;
	for (const run of runs) {
		if (cursor.x !== run.start.x || cursor.y !== run.start.y)
			commands.push(`L ${run.start.x} ${run.start.y}`);
		const distances = [...(bridges.get(run) ?? [])]
			.map((point) => distanceAlong(run, point))
			.sort((left, right) => left - right);
		for (const distance of distances) {
			const before = pointAlong(run, distance - BRIDGE_RADIUS);
			const after = pointAlong(run, distance + BRIDGE_RADIUS);
			commands.push(`L ${before.x} ${before.y}`);
			const sweep = bridgeSweep(run, pointAlong(run, distance), parallels);
			commands.push(`A ${BRIDGE_RADIUS} ${BRIDGE_RADIUS} 0 0 ${sweep} ${after.x} ${after.y}`);
		}
		commands.push(`L ${run.end.x} ${run.end.y}`);
		cursor = run.end;
	}
	return commands.join(' ');
}

function strictlyContains(run: RouteRun, point: Point): boolean {
	if (run.orientation === RouteOrientation.Horizontal) {
		const sameCross = run.start.y === point.y;
		const within =
			point.x > Math.min(run.start.x, run.end.x) && point.x < Math.max(run.start.x, run.end.x);
		return sameCross && within;
	}
	const sameCross = run.start.x === point.x;
	const within =
		point.y > Math.min(run.start.y, run.end.y) && point.y < Math.max(run.start.y, run.end.y);
	return sameCross && within;
}

/**
 * Crossings and nearby parallels of distinct relations need different ink. Color clusters depend
 * only on which relations touch, so each crossing is one contact and parallels come from the index.
 */
function colorContactsFor(
	runsByRelation: readonly (readonly RouteRun[])[],
	crossings: readonly RouteCrossing[],
	parallels: ParallelRuns,
): readonly (readonly [string, string])[] {
	const contacts: (readonly [string, string])[] = crossings.map(
		({ horizontalId, verticalId }) => [horizontalId, verticalId] as const,
	);
	for (const [relationIndex, runs] of runsByRelation.entries())
		for (const run of runs) {
			const earlier = nearbyParallels(parallels, run, PARALLEL_COLOR_DISTANCE).filter(
				(other) => other.relationIndex < relationIndex && parallelSegmentsAreClose(run, other.run),
			);
			for (const other of earlier) contacts.push([run.pathId, other.run.pathId]);
		}
	return contacts;
}

/** Bridge points by carrier run; every carrier belongs to these relations, read by the same oracle. */
function bridgePointsByRun(
	runsByRelation: readonly (readonly RouteRun[])[],
	bridges: readonly LayoutBridge[],
): ReadonlyMap<RouteRun, readonly Point[]> {
	const runsByPath = new Map<string, RouteRun[]>();
	for (const run of runsByRelation.flat()) {
		const pathRuns = runsByPath.get(run.pathId) ?? [];
		pathRuns.push(run);
		runsByPath.set(run.pathId, pathRuns);
	}
	const points = new Map<RouteRun, Point[]>();
	for (const bridge of bridges) {
		const carriers = bridge.carrierIds.flatMap((id) => defined(runsByPath.get(id)));
		for (const run of carriers.filter((carrier) => strictlyContains(carrier, bridge))) {
			const carried = points.get(run) ?? [];
			carried.push(bridge);
			points.set(run, carried);
		}
	}
	return points;
}

/**
 * Draws the relations of a layout. The bridges come from the shared oracle, which is the single
 * decision of where an arc is drawn: the canvas only chooses its bulge. A crossing the oracle does
 * not validate stays a straight line.
 */
export function renderRelationPaths(
	relations: readonly LayoutRelation[],
	palette: RoutePalette = DEFAULT_ROUTE_PALETTE,
): readonly RenderedRelation[] {
	const runsByRelation = relations.map((relation) => routeRuns(relation));
	const parallels = parallelRuns(runsByRelation);
	const { crossings, bridges } = routeBridgeAnalysis(relations);
	const bridgePoints = bridgePointsByRun(runsByRelation, bridges);
	const colors = relationColors(
		relations,
		colorContactsFor(runsByRelation, crossings, parallels),
		palette,
	);
	return runsByRelation.map((runs, index) => {
		const relation = defined(relations[index]);
		return {
			...relation,
			path: pathFor(runs, bridgePoints, parallels),
			color: defined(colors.get(relation.id)),
		};
	});
}
