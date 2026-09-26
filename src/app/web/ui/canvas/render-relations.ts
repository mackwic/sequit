import { defined } from '../../../../lib/core/document/logic-document';
import {
	routeBridgeAnalysis,
	RouteOrientation,
	type RouteRun,
	routeRuns,
} from '../../../../lib/core/layout/bridges/bridge-oracle';
import { BRIDGE_CLEARANCE, BRIDGE_RADIUS } from '../../../../lib/core/layout/layout-settings';
import type { LayoutRelation, Point } from '../../projection/layout-graph';
import { parallelSegmentsAreClose, relationColors } from './relation-colors';
import { DEFAULT_ROUTE_PALETTE, type RoutePalette } from './route-color-palette';

export interface RenderedRelation extends LayoutRelation {
	readonly path: string;
	readonly color: string;
}

function pairKey(horizontalId: string, verticalId: string): string {
	return `${horizontalId}\u0000${verticalId}`;
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

/** The visual side of a bridge: the bulge avoids a parallel trunk closer than the clearance. */
function bridgeSweep(run: RouteRun, point: Point, runs: readonly RouteRun[]): number {
	const horizontal = run.orientation === RouteOrientation.Horizontal;
	const axis = horizontal ? 'x' : 'y';
	const cross = horizontal ? 'y' : 'x';
	let side = Math.sign(run.end[axis] - run.start[axis]);
	if (horizontal) side = -side;
	let current = Number.POSITIVE_INFINITY;
	let opposite = Number.POSITIVE_INFINITY;
	for (const other of runs) {
		if (other.orientation !== run.orientation) continue;
		const start = Math.min(other.start[axis], other.end[axis]);
		const end = Math.max(other.start[axis], other.end[axis]);
		const before = point[axis] - BRIDGE_RADIUS;
		const after = point[axis] + BRIDGE_RADIUS;
		if (end < before || start > after) continue;
		const offset = (other.start[cross] - point[cross]) * side;
		if (offset > 0) current = Math.min(current, offset);
		if (offset < 0) opposite = Math.min(opposite, -offset);
	}
	const minimum = BRIDGE_RADIUS + BRIDGE_CLEARANCE;
	if (current < minimum && opposite > current) return 0;
	return 1;
}

function pathFor(
	runs: readonly RouteRun[],
	bridges: ReadonlyMap<RouteRun, readonly Point[]>,
	allRuns: readonly RouteRun[],
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
			const sweep = bridgeSweep(run, pointAlong(run, distance), allRuns);
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

function pairKeyFor(run: RouteRun, previous: RouteRun): string {
	if (run.orientation === RouteOrientation.Horizontal) return pairKey(run.pathId, previous.pathId);
	return pairKey(previous.pathId, run.pathId);
}

function needsContrast(
	run: RouteRun,
	previous: RouteRun,
	crossingPairs: ReadonlySet<string>,
): boolean {
	return crossingPairs.has(pairKeyFor(run, previous)) || parallelSegmentsAreClose(run, previous);
}

/** Crossings and nearby parallels need different ink; both are read from the same run pairs. */
function colorContactsFor(
	runsByRelation: readonly (readonly RouteRun[])[],
	crossingPairs: ReadonlySet<string>,
): readonly (readonly [string, string])[] {
	const contacts: (readonly [string, string])[] = [];
	const previousRuns: RouteRun[] = [];
	for (const runs of runsByRelation) {
		for (const run of runs) {
			const touched = previousRuns.filter((previous) =>
				needsContrast(run, previous, crossingPairs),
			);
			for (const previous of touched) contacts.push([run.pathId, previous.pathId]);
		}
		previousRuns.push(...runs);
	}
	return contacts;
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
	const allRuns = runsByRelation.flat();
	const { crossings, bridges } = routeBridgeAnalysis(relations);
	const crossingPairs = new Set(
		crossings.map((crossing) => pairKey(crossing.horizontalId, crossing.verticalId)),
	);
	const bridgePoints = new Map<RouteRun, Point[]>();
	for (const bridge of bridges) {
		for (const run of allRuns) {
			if (!bridge.carrierIds.includes(run.pathId)) continue;
			if (!strictlyContains(run, bridge)) continue;
			const points = bridgePoints.get(run) ?? [];
			points.push(bridge);
			bridgePoints.set(run, points);
		}
	}
	const colors = relationColors(
		relations,
		colorContactsFor(runsByRelation, crossingPairs),
		palette,
	);
	return runsByRelation.map((runs, index) => {
		const relation = defined(relations[index]);
		return {
			...relation,
			path: pathFor(runs, bridgePoints, allRuns),
			color: defined(colors.get(relation.id)),
		};
	});
}
