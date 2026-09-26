import { defined } from '../document/logic-document';
import { type RoutedPath, type RouteRun, routeRuns } from './bridge-oracle';
import type { Point } from './layout-types';
import { samePoint } from './nested-region-geometry-primitives';

/** Endpoint identity is optional for a route piece: only its attached end is declared. */
export interface EndpointRoute extends RoutedPath {
	readonly from?: string;
	readonly to?: string;
}

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

export function endpointId(route: EndpointRoute, from: boolean): string | undefined {
	if (from) return route.from;
	return route.to;
}

export function endpointPoint(route: EndpointRoute, from: boolean): Point | undefined {
	if (from) return route.points[0];
	return route.points.at(-1);
}

function continuationPoint(run: RouteRun, from: boolean): Point {
	if (from) return run.end;
	return run.start;
}

export function sharedAtEndpoint(
	first: EndpointRoute,
	second: EndpointRoute,
	point: Point,
	from: boolean,
): boolean {
	const id = endpointId(first, from);
	if (id === undefined || id !== endpointId(second, from)) return false;
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

/** A point-only node connection may join routes with opposite endpoint roles. */
export function sharedAttachmentPoint(
	first: EndpointRoute,
	second: EndpointRoute,
	point: Point,
): boolean {
	for (const fromFirst of [true, false])
		for (const fromSecond of [true, false]) {
			const firstId = endpointId(first, fromFirst);
			if (firstId === undefined || firstId !== endpointId(second, fromSecond)) continue;
			const firstAnchor = endpointPoint(first, fromFirst);
			const secondAnchor = endpointPoint(second, fromSecond);
			if (firstAnchor === undefined || secondAnchor === undefined) continue;
			if (samePoint(firstAnchor, point) && samePoint(secondAnchor, point)) return true;
		}
	return false;
}
