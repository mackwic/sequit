import type { LayoutRelation, Point } from '../../../../../src/app/web/projection/layout-graph';
import {
	parallelSegmentsAreClose,
	relationColors,
} from '../../../../../src/app/web/ui/canvas/relation-colors';
import type { RenderedRelation } from '../../../../../src/app/web/ui/canvas/render-relations';
import { defined } from '../../../../../src/lib/core/document/logic-document';
import { routeBridgeAnalysis } from '../../../../../src/lib/core/layout/bridges/bridge-oracle';
import {
	RouteOrientation,
	type RouteRun,
	routeRuns,
} from '../../../../../src/lib/core/layout/bridges/route-runs';
import {
	BRIDGE_CLEARANCE,
	BRIDGE_RADIUS,
} from '../../../../../src/lib/core/layout/layout-settings';

function alongRun(run: RouteRun, distance: number): Point {
	if (run.orientation === RouteOrientation.Horizontal)
		return { x: run.start.x + Math.sign(run.end.x - run.start.x) * distance, y: run.start.y };
	return { x: run.start.x, y: run.start.y + Math.sign(run.end.y - run.start.y) * distance };
}

/** Every parallel run of the document is read to choose the bulge. */
function referenceSweep(run: RouteRun, point: Point, runs: readonly RouteRun[]): number {
	let axis: 'x' | 'y' = 'y';
	let cross: 'x' | 'y' = 'x';
	if (run.orientation === RouteOrientation.Horizontal) {
		axis = 'x';
		cross = 'y';
	}
	let side = Math.sign(run.end[axis] - run.start[axis]);
	if (axis === 'x') side = -side;
	let current = Number.POSITIVE_INFINITY;
	let opposite = Number.POSITIVE_INFINITY;
	for (const other of runs) {
		if (other.orientation !== run.orientation) continue;
		const start = Math.min(other.start[axis], other.end[axis]);
		const end = Math.max(other.start[axis], other.end[axis]);
		if (end < point[axis] - BRIDGE_RADIUS || start > point[axis] + BRIDGE_RADIUS) continue;
		const offset = (other.start[cross] - point[cross]) * side;
		if (offset > 0) current = Math.min(current, offset);
		if (offset < 0) opposite = Math.min(opposite, -offset);
	}
	if (current < BRIDGE_RADIUS + BRIDGE_CLEARANCE && opposite > current) return 0;
	return 1;
}

function referencePath(
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
		const distances = (bridges.get(run) ?? [])
			.map((point) => Math.abs(point.x - run.start.x) + Math.abs(point.y - run.start.y))
			.sort((left, right) => left - right);
		for (const distance of distances) {
			const before = alongRun(run, distance - BRIDGE_RADIUS);
			const after = alongRun(run, distance + BRIDGE_RADIUS);
			commands.push(`L ${before.x} ${before.y}`);
			const sweep = referenceSweep(run, alongRun(run, distance), allRuns);
			commands.push(`A ${BRIDGE_RADIUS} ${BRIDGE_RADIUS} 0 0 ${sweep} ${after.x} ${after.y}`);
		}
		commands.push(`L ${run.end.x} ${run.end.y}`);
		cursor = run.end;
	}
	return commands.join(' ');
}

function strictlyInside(run: RouteRun, point: Point): boolean {
	const low = { x: Math.min(run.start.x, run.end.x), y: Math.min(run.start.y, run.end.y) };
	const high = { x: Math.max(run.start.x, run.end.x), y: Math.max(run.start.y, run.end.y) };
	if (run.orientation === RouteOrientation.Horizontal)
		return run.start.y === point.y && point.x > low.x && point.x < high.x;
	return run.start.x === point.x && point.y > low.y && point.y < high.y;
}

/** Exhaustive scans: every bridge reads every run, every run every run of earlier relations. */
export function referenceRenderRelationPaths(
	relations: readonly LayoutRelation[],
): readonly RenderedRelation[] {
	const runsByRelation = relations.map((relation) => routeRuns(relation));
	const allRuns = runsByRelation.flat();
	const { crossings, bridges } = routeBridgeAnalysis(relations);
	const crossingPairs = new Set(
		crossings.map(({ horizontalId, verticalId }) => `${horizontalId}\u0000${verticalId}`),
	);
	const bridgePoints = new Map<RouteRun, Point[]>();
	for (const bridge of bridges)
		for (const run of allRuns) {
			if (!bridge.carrierIds.includes(run.pathId) || !strictlyInside(run, bridge)) continue;
			bridgePoints.set(run, [...(bridgePoints.get(run) ?? []), bridge]);
		}
	const contacts: (readonly [string, string])[] = [];
	const previousRuns: RouteRun[] = [];
	for (const runs of runsByRelation) {
		for (const run of runs)
			for (const previous of previousRuns) {
				let key = `${previous.pathId}\u0000${run.pathId}`;
				if (run.orientation === RouteOrientation.Horizontal)
					key = `${run.pathId}\u0000${previous.pathId}`;
				if (crossingPairs.has(key) || parallelSegmentsAreClose(run, previous))
					contacts.push([run.pathId, previous.pathId]);
			}
		previousRuns.push(...runs);
	}
	const colors = relationColors(relations, contacts);
	return runsByRelation.map((runs, index) => {
		const relation = defined(relations[index]);
		return {
			...relation,
			path: referencePath(runs, bridgePoints, allRuns),
			color: defined(colors.get(relation.id)),
		};
	});
}
