import type { Bounds, Point } from './layout-types';

export function samePoint(left: Point, right: Point): boolean {
	return left.x === right.x && left.y === right.y;
}

export function finiteBounds(bounds: Bounds): boolean {
	if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
	if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return false;
	return bounds.width > 0 && bounds.height > 0;
}

export function within(outer: Bounds, point: Point): boolean {
	const right = outer.x + outer.width;
	const bottom = outer.y + outer.height;
	if (point.x < outer.x || point.x > right) return false;
	return point.y >= outer.y && point.y <= bottom;
}

export function inside(outer: Bounds, inner: Bounds): boolean {
	if (inner.x <= outer.x || inner.y <= outer.y) return false;
	if (inner.x + inner.width >= outer.x + outer.width) return false;
	return inner.y + inner.height < outer.y + outer.height;
}

export function overlaps(left: Bounds, right: Bounds): boolean {
	const leftRight = left.x + left.width;
	const rightRight = right.x + right.width;
	const leftBottom = left.y + left.height;
	const rightBottom = right.y + right.height;
	const x = left.x < rightRight && leftRight > right.x;
	const y = left.y < rightBottom && leftBottom > right.y;
	return x && y;
}

/** Strict interiors: contact with a boundary at a declared portal is legal. */
export function entersInterior(from: Point, to: Point, bounds: Bounds): boolean {
	if (from.x === to.x) {
		const right = bounds.x + bounds.width;
		if (from.x <= bounds.x || from.x >= right) return false;
		const belowTop = Math.max(from.y, to.y) > bounds.y;
		const aboveBottom = Math.min(from.y, to.y) < bounds.y + bounds.height;
		return belowTop && aboveBottom;
	}
	if (from.y === to.y) {
		const bottom = bounds.y + bounds.height;
		if (from.y <= bounds.y || from.y >= bottom) return false;
		const rightOfLeft = Math.max(from.x, to.x) > bounds.x;
		const leftOfRight = Math.min(from.x, to.x) < bounds.x + bounds.width;
		return rightOfLeft && leftOfRight;
	}
	return true;
}

export function orthogonal(points: readonly Point[]): boolean {
	if (points.length < 2) return false;
	if (points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) return false;
	for (let index = 1; index < points.length; index += 1) {
		const current = points[index];
		const previous = points[index - 1];
		if (current === undefined || previous === undefined) return false;
		if (current.x !== previous.x && current.y !== previous.y) return false;
	}
	return true;
}

export function segmentEnters(points: readonly Point[], bounds: Bounds): boolean {
	for (let index = 1; index < points.length; index += 1) {
		const current = points[index];
		const previous = points[index - 1];
		if (current === undefined || previous === undefined) return true;
		if (entersInterior(previous, current, bounds)) return true;
	}
	return false;
}

function intervalTouches(
	firstStart: number,
	firstEnd: number,
	secondStart: number,
	secondEnd: number,
): boolean {
	const firstMinimum = Math.min(firstStart, firstEnd);
	const firstMaximum = Math.max(firstStart, firstEnd);
	const secondMinimum = Math.min(secondStart, secondEnd);
	const secondMaximum = Math.max(secondStart, secondEnd);
	return Math.max(firstMinimum, secondMinimum) <= Math.min(firstMaximum, secondMaximum);
}

function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
	if (a.x === b.x && c.x === d.x) {
		if (a.x !== c.x) return false;
		return intervalTouches(a.y, b.y, c.y, d.y);
	}
	if (a.y === b.y && c.y === d.y) {
		if (a.y !== c.y) return false;
		return intervalTouches(a.x, b.x, c.x, d.x);
	}
	if (a.x === b.x) {
		const verticalTouches = intervalTouches(a.y, b.y, c.y, c.y);
		const horizontalTouches = intervalTouches(c.x, d.x, a.x, a.x);
		return verticalTouches && horizontalTouches;
	}
	const verticalTouches = intervalTouches(c.y, d.y, a.y, a.y);
	const horizontalTouches = intervalTouches(a.x, b.x, c.x, c.x);
	return verticalTouches && horizontalTouches;
}

/** Conservative parent corridor check: a contact needs an explicit sharing or bridge policy. */
export function orthogonalPathsTouch(first: readonly Point[], second: readonly Point[]): boolean {
	for (let left = 1; left < first.length; left += 1) {
		const a = first[left - 1];
		const b = first[left];
		if (a === undefined || b === undefined) return true;
		for (let right = 1; right < second.length; right += 1) {
			const c = second[right - 1];
			const d = second[right];
			if (c === undefined || d === undefined) return true;
			if (segmentsTouch(a, b, c, d)) return true;
		}
	}
	return false;
}
