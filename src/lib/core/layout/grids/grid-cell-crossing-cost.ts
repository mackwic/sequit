import { defined } from '../../document/logic-document';
import { strictCrossing } from '../geometry/strict-crossing';
import type { LayoutRelation, Point } from '../layout-types';
import { equal, samePoint } from './grid-cell-geometry-primitives';

type RoutesCost = readonly [crossings: number, length: number, bends: number];

interface RouteSegment {
	readonly route: number;
	readonly start: Point;
	readonly end: Point;
}

/** The non-degenerate segments of a set of routes, split by orientation. */
function routeSegments(routes: readonly LayoutRelation[]): {
	readonly horizontal: readonly RouteSegment[];
	readonly vertical: readonly RouteSegment[];
} {
	const horizontal: RouteSegment[] = [];
	const vertical: RouteSegment[] = [];
	for (const [route, { points }] of routes.entries())
		for (let index = 1; index < points.length; index += 1) {
			const segment = { route, start: defined(points[index - 1]), end: defined(points[index]) };
			if (samePoint(segment.start, segment.end)) continue;
			if (equal(segment.start.y, segment.end.y)) horizontal.push(segment);
			else vertical.push(segment);
		}
	return { horizontal, vertical };
}

/** Proper crossings between two different routes: a contact at a port or a bend does not count. */
function strictCrossingCount(routes: readonly LayoutRelation[]): number {
	const { horizontal, vertical } = routeSegments(routes);
	let count = 0;
	for (const across of horizontal)
		for (const along of vertical) {
			if (across.route === along.route) continue;
			const crossing = strictCrossing(along.start, along.end, across.start, across.end);
			if (crossing !== undefined) count += 1;
		}
	return count;
}

/** Length and direction changes of one orthogonal route. */
function routeShape(points: readonly Point[]): readonly [length: number, bends: number] {
	let length = 0;
	let bends = 0;
	for (let index = 1; index < points.length; index += 1) {
		const previous = defined(points[index - 1]);
		const point = defined(points[index]);
		const run = Math.abs(point.x - previous.x);
		length += run + Math.abs(point.y - previous.y);
		const before = points[index - 2];
		if (before === undefined) continue;
		if (equal(before.y, previous.y) !== equal(previous.y, point.y)) bends += 1;
	}
	return [length, bends];
}

/** Proper crossings between routes (local routes included), total length, then bends. */
function routesCost(routes: readonly LayoutRelation[]): RoutesCost {
	let length = 0;
	let bends = 0;
	for (const { points } of routes) {
		const [routeLength, routeBends] = routeShape(points);
		length += routeLength;
		bends += routeBends;
	}
	return [strictCrossingCount(routes), length, bends];
}

/** True when the first routes cost less: fewer crossings, then shorter, then fewer bends. */
function cheaper(first: readonly LayoutRelation[], second: readonly LayoutRelation[]): boolean {
	const firstCost = routesCost(first);
	const secondCost = routesCost(second);
	for (const [index, value] of firstCost.entries()) {
		const other = defined(secondCost[index]);
		if (value !== other) return value < other;
	}
	return false;
}

interface RoutedAttempt {
	readonly failure?: unknown;
	readonly candidate: { readonly layout: { readonly relations: readonly LayoutRelation[] } };
}

/**
 * The gap form of one allocation when it validates and costs less than its gutter form, else the
 * gutter form, whose failure then drives the search exactly as before.
 */
export function cheaperRoute<Attempt extends RoutedAttempt>(
	gutter: Attempt,
	gap: Attempt,
): Attempt {
	if (gap.failure !== undefined) return gutter;
	if (gutter.failure !== undefined) return gap;
	if (cheaper(gap.candidate.layout.relations, gutter.candidate.layout.relations)) return gap;
	return gutter;
}
interface SearchOutcome {
	readonly witness: unknown;
	readonly selected?: RoutedAttempt;
}

/**
 * The search that also tries the gap forms replaces the gutter-only search only when the latter
 * selects nothing, or when its selection costs less: no layout gains a crossing or length.
 */
export function cheaperSearch<Result extends SearchOutcome>(gutter: Result, mixed: Result): Result {
	if (mixed.selected === undefined) return gutter;
	if (gutter.selected === undefined) return mixed;
	const mixedRoutes = mixed.selected.candidate.layout.relations;
	if (cheaper(mixedRoutes, gutter.selected.candidate.layout.relations)) return mixed;
	return gutter;
}
