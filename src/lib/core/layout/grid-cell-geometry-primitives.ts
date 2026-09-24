import { defined } from '../document/logic-document';
import type { Bounds, LayoutRelation, Point } from './layout-types';

const EPSILON = 1e-6;

export function equal(left: number, right: number): boolean {
	return Math.abs(left - right) <= EPSILON;
}

export function samePoint(left: Point, right: Point): boolean {
	return equal(left.x, right.x) && equal(left.y, right.y);
}

export function finiteBounds(bounds: Bounds): boolean {
	const checks = [
		Number.isFinite(bounds.x),
		Number.isFinite(bounds.y),
		Number.isFinite(bounds.width),
		Number.isFinite(bounds.height),
		bounds.width > 0,
		bounds.height > 0,
	];
	return checks.every(Boolean);
}

export function within(outer: Bounds, inner: Bounds): boolean {
	if (inner.x < outer.x - EPSILON) return false;
	if (inner.y < outer.y - EPSILON) return false;
	const innerRight = inner.x + inner.width;
	const outerRight = outer.x + outer.width + EPSILON;
	if (innerRight > outerRight) return false;
	const innerBottom = inner.y + inner.height;
	const outerBottom = outer.y + outer.height + EPSILON;
	return innerBottom <= outerBottom;
}

function strictlyBetween(value: number, minimum: number, maximum: number): boolean {
	const low = minimum + EPSILON;
	const high = maximum - EPSILON;
	return value > low && value < high;
}

function intervalEnters(first: number, second: number, minimum: number, maximum: number): boolean {
	const low = minimum + EPSILON;
	const high = maximum - EPSILON;
	return Math.max(first, second) > low && Math.min(first, second) < high;
}

export function entersInterior(start: Point, end: Point, bounds: Bounds): boolean {
	if (equal(start.x, end.x)) {
		const insideX = strictlyBetween(start.x, bounds.x, bounds.x + bounds.width);
		return insideX && intervalEnters(start.y, end.y, bounds.y, bounds.y + bounds.height);
	}
	if (equal(start.y, end.y)) {
		const insideY = strictlyBetween(start.y, bounds.y, bounds.y + bounds.height);
		return insideY && intervalEnters(start.x, end.x, bounds.x, bounds.x + bounds.width);
	}
	return true;
}

export function validPath(route: LayoutRelation): boolean {
	if (route.points.length < 2) return false;
	for (const point of route.points) {
		if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
	}
	for (let index = 1; index < route.points.length; index += 1) {
		const previous = defined(route.points[index - 1]);
		const point = defined(route.points[index]);
		if (!equal(point.x, previous.x) && !equal(point.y, previous.y)) return false;
	}
	return true;
}

export function sameBounds(left: Bounds, right: Bounds): boolean {
	return [
		equal(left.x, right.x),
		equal(left.y, right.y),
		equal(left.width, right.width),
		equal(left.height, right.height),
	].every(Boolean);
}
