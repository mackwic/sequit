import { defined } from '../../document/logic-document';
import type { RouteRun } from '../bridge-oracle';
import { routeRuns } from '../bridge-oracle';
import type { LayoutRelation, Point } from '../layout-types';
import { samePoint } from './route-geometry';

function coordinate(point: Point, horizontal: boolean): number {
	if (horizontal) return point.x;
	return point.y;
}

function isHorizontal(run: RouteRun): boolean {
	return run.start.y === run.end.y;
}

function anchor(run: RouteRun, from: boolean): Point {
	if (from) return run.start;
	return run.end;
}

function farEnd(run: RouteRun, from: boolean): Point {
	if (from) return run.end;
	return run.start;
}

function directionFromAnchor(
	anchorPoint: Point,
	farPoint: Point,
	horizontal: boolean,
	from: boolean,
): number {
	const difference = coordinate(farPoint, horizontal) - coordinate(anchorPoint, horizontal);
	if (from) return difference;
	return -difference;
}

function sharedFarCoordinate(
	first: number,
	second: number,
	direction: number,
	from: boolean,
): number {
	if (from) {
		if (direction > 0) return Math.min(first, second);
		return Math.max(first, second);
	}
	if (direction > 0) return Math.max(first, second);
	return Math.min(first, second);
}

function pointOnSharedRun(first: RouteRun, second: RouteRun, point: Point, from: boolean): boolean {
	const horizontal = isHorizontal(first);
	if (horizontal !== isHorizontal(second)) return false;
	const firstAnchor = anchor(first, from);
	const secondAnchor = anchor(second, from);
	const firstFar = farEnd(first, from);
	const secondFar = farEnd(second, from);
	const firstDirection = directionFromAnchor(firstAnchor, firstFar, horizontal, from);
	const secondDirection = directionFromAnchor(secondAnchor, secondFar, horizontal, from);
	if (firstDirection > 0 !== secondDirection > 0) return false;
	const anchorCoordinate = coordinate(firstAnchor, horizontal);
	const sharedFar = sharedFarCoordinate(
		coordinate(firstFar, horizontal),
		coordinate(secondFar, horizontal),
		firstDirection,
		from,
	);
	const pointCoordinate = coordinate(point, horizontal);
	const pointCross = coordinate(point, !horizontal);
	const anchorCross = coordinate(firstAnchor, !horizontal);
	if (pointCross !== anchorCross) return false;
	return (
		pointCoordinate >= Math.min(anchorCoordinate, sharedFar) &&
		pointCoordinate <= Math.max(anchorCoordinate, sharedFar)
	);
}

function endpointId(route: LayoutRelation, from: boolean): string {
	if (from) return route.from;
	return route.to;
}

function endpointPoint(route: LayoutRelation, from: boolean): Point | undefined {
	if (from) return route.points[0];
	return route.points.at(-1);
}

function continuationPoint(run: RouteRun, from: boolean): Point {
	if (from) return run.end;
	return run.start;
}

export function sharedAtEndpoint(
	first: LayoutRelation,
	second: LayoutRelation,
	point: Point,
	from: boolean,
): boolean {
	if (endpointId(first, from) !== endpointId(second, from)) return false;
	const firstPoint = defined(endpointPoint(first, from));
	const secondPoint = defined(endpointPoint(second, from));
	if (!samePoint(firstPoint, secondPoint)) return false;
	const firstRuns = routeRuns(first);
	const secondRuns = routeRuns(second);
	const runCount = Math.min(firstRuns.length, secondRuns.length);
	for (let offset = 0; offset < runCount; offset += 1) {
		let firstIndex = offset;
		let secondIndex = offset;
		if (!from) {
			firstIndex = firstRuns.length - offset - 1;
			secondIndex = secondRuns.length - offset - 1;
		}
		const firstRun = defined(firstRuns[firstIndex]);
		const secondRun = defined(secondRuns[secondIndex]);
		if (pointOnSharedRun(firstRun, secondRun, point, from)) return true;
		const firstContinuation = continuationPoint(firstRun, from);
		const secondContinuation = continuationPoint(secondRun, from);
		if (!samePoint(firstContinuation, secondContinuation)) return false;
	}
	return false;
}
