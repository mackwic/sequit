import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import type {
	LayoutBridge,
	RouteBridgeAnalysis,
	RouteCrossing,
} from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import {
	type RoutedPath,
	RouteOrientation,
	type RouteRun,
} from '../../../../src/lib/core/layout/bridges/route-runs';
import { BRIDGE_CLEARANCE, BRIDGE_RADIUS } from '../../../../src/lib/core/layout/layout-settings';
import type { Point } from '../../../../src/lib/core/layout/layout-types';

interface ReferenceScan {
	readonly runs: readonly RouteRun[];
	readonly carried: Map<RouteRun, Point[]>;
	readonly crossings: Map<string, RouteCrossing>;
	readonly bridges: Map<string, LayoutBridge>;
}

function strictPoint(first: RouteRun, second: RouteRun): Point | undefined {
	if (first.orientation === second.orientation) return undefined;
	let horizontal = first;
	let vertical = second;
	if (first.orientation === RouteOrientation.Vertical) {
		horizontal = second;
		vertical = first;
	}
	const x = vertical.start.x;
	const y = horizontal.start.y;
	const horizontalLow = Math.min(horizontal.start.x, horizontal.end.x);
	const horizontalHigh = Math.max(horizontal.start.x, horizontal.end.x);
	const verticalLow = Math.min(vertical.start.y, vertical.end.y);
	const verticalHigh = Math.max(vertical.start.y, vertical.end.y);
	if (x <= horizontalLow || x >= horizontalHigh) return undefined;
	if (y <= verticalLow || y >= verticalHigh) return undefined;
	return { x, y };
}

/** The old oracle's unindexed scan checks every run in canonical geometric path order. */
function allCarriers(runs: readonly RouteRun[], run: RouteRun, point: Point): readonly RouteRun[] {
	return runs.filter((candidate) => {
		if (candidate.orientation !== run.orientation) return false;
		if (candidate.orientation === RouteOrientation.Horizontal) {
			const low = Math.min(candidate.start.x, candidate.end.x);
			const high = Math.max(candidate.start.x, candidate.end.x);
			return candidate.start.y === point.y && point.x > low && point.x < high;
		}
		const low = Math.min(candidate.start.y, candidate.end.y);
		const high = Math.max(candidate.start.y, candidate.end.y);
		return candidate.start.x === point.x && point.y > low && point.y < high;
	});
}

function hasClearance(run: RouteRun, point: Point, carried: readonly Point[]): boolean {
	let start = run.start.y;
	let end = run.end.y;
	let coordinate = point.y;
	if (run.orientation === RouteOrientation.Horizontal) {
		start = run.start.x;
		end = run.end.x;
		coordinate = point.x;
	}
	const minimum = BRIDGE_RADIUS + BRIDGE_CLEARANCE;
	if (coordinate - Math.min(start, end) < minimum) return false;
	if (Math.max(start, end) - coordinate < minimum) return false;
	const separation = BRIDGE_RADIUS * 2 + BRIDGE_CLEARANCE;
	return carried.every((previous) => {
		let previousCoordinate = previous.y;
		if (run.orientation === RouteOrientation.Horizontal) previousCoordinate = previous.x;
		const distance = Math.abs(previousCoordinate - coordinate);
		return distance === 0 || distance >= separation;
	});
}

function recordReferenceBridge(
	scan: ReferenceScan,
	point: Point,
	current: RouteRun,
	previous: RouteRun,
): void {
	const groups = [current, previous].map((run) => allCarriers(scan.runs, run, point));
	const alreadyCarried = groups
		.flat()
		.some((run) =>
			(scan.carried.get(run) ?? []).some((placed) => placed.x === point.x && placed.y === point.y),
		);
	if (alreadyCarried) return;
	const carrierGroup = groups.find((group) =>
		group.every((run) => hasClearance(run, point, scan.carried.get(run) ?? [])),
	);
	if (carrierGroup === undefined) return;
	for (const run of carrierGroup) {
		const points = scan.carried.get(run) ?? [];
		points.push(point);
		scan.carried.set(run, points);
	}
	const crossed = groups.filter((group) => group !== carrierGroup).flat();
	const bridge: LayoutBridge = {
		...point,
		carrierIds: [...new Set(carrierGroup.map((run) => run.pathId))].sort(compareCanonicalStrings),
		crossedIds: [...new Set(crossed.map((run) => run.pathId))].sort(compareCanonicalStrings),
	};
	const key = `${bridge.x}:${bridge.y}:${bridge.carrierIds.join(',')}:${bridge.crossedIds.join(',')}`;
	scan.bridges.set(key, bridge);
}

function recordReferencePair(scan: ReferenceScan, current: RouteRun, previous: RouteRun): void {
	const point = strictPoint(current, previous);
	if (point === undefined) return;
	let horizontal = previous;
	let vertical = current;
	if (current.orientation === RouteOrientation.Horizontal) {
		horizontal = current;
		vertical = previous;
	}
	const crossing: RouteCrossing = {
		...point,
		horizontalId: horizontal.pathId,
		verticalId: vertical.pathId,
	};
	const key = `${point.x}:${point.y}:${crossing.horizontalId}:${crossing.verticalId}`;
	scan.crossings.set(key, crossing);
	recordReferenceBridge(scan, point, current, previous);
}

/** Decode maximal straight runs from waypoints without using the indexed oracle's parser. */
function referenceRuns(path: RoutedPath): RouteRun[] {
	const runs: RouteRun[] = [];
	for (let index = 1; index < path.points.length; index += 1) {
		const start = path.points[index - 1];
		const end = path.points[index];
		if (start === undefined || end === undefined) continue;
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		if ((dx === 0) === (dy === 0)) continue;
		let orientation = RouteOrientation.Horizontal;
		if (dx === 0) orientation = RouteOrientation.Vertical;
		const previous = runs.at(-1);
		if (
			previous?.orientation === orientation &&
			previous.end.x === start.x &&
			previous.end.y === start.y &&
			Math.sign(dx + dy) ===
				Math.sign(previous.end.x - previous.start.x + previous.end.y - previous.start.y)
		) {
			runs[runs.length - 1] = { ...previous, end };
		} else {
			runs.push({ pathId: path.id, start, end, orientation });
		}
	}
	return runs;
}

function compareRouteGeometry(left: RoutedPath, right: RoutedPath): number {
	const sharedLength = Math.min(left.points.length, right.points.length);
	for (let index = 0; index < sharedLength; index += 1) {
		const leftPoint = left.points[index];
		const rightPoint = right.points[index];
		if (leftPoint === undefined || rightPoint === undefined) continue;
		const byX = leftPoint.x - rightPoint.x;
		if (byX !== 0) return byX;
		const byY = leftPoint.y - rightPoint.y;
		if (byY !== 0) return byY;
	}
	const byLength = left.points.length - right.points.length;
	if (byLength !== 0) return byLength;
	return compareCanonicalStrings(left.id, right.id);
}

/** Independent, exhaustive pre-index crossing/carrier oracle; no production bridge analysis calls. */
export function referenceRouteBridgeAnalysis(paths: readonly RoutedPath[]): RouteBridgeAnalysis {
	const sortedPaths = [...paths].sort(compareRouteGeometry);
	const runsByPath = sortedPaths.map(referenceRuns);
	const scan: ReferenceScan = {
		runs: runsByPath.flat(),
		carried: new Map(),
		crossings: new Map(),
		bridges: new Map(),
	};
	const previousRuns: RouteRun[] = [];
	for (const pathRuns of runsByPath) {
		for (const run of pathRuns)
			for (const previous of previousRuns) recordReferencePair(scan, run, previous);
		previousRuns.push(...pathRuns);
	}
	const crossings = [...scan.crossings.values()].sort((left, right) => {
		const byPoint = left.x - right.x || left.y - right.y;
		if (byPoint !== 0) return byPoint;
		const byHorizontal = compareCanonicalStrings(left.horizontalId, right.horizontalId);
		if (byHorizontal !== 0) return byHorizontal;
		return compareCanonicalStrings(left.verticalId, right.verticalId);
	});
	const bridges = [...scan.bridges.values()].sort((left, right) => {
		const byPoint = left.x - right.x || left.y - right.y;
		if (byPoint !== 0) return byPoint;
		const firstKey = `${left.x}:${left.y}:${left.carrierIds.join(',')}:${left.crossedIds.join(',')}`;
		const secondKey = `${right.x}:${right.y}:${right.carrierIds.join(',')}:${right.crossedIds.join(',')}`;
		return compareCanonicalStrings(firstKey, secondKey);
	});
	return { crossings, bridges, inspectedRuns: scan.runs.length };
}
