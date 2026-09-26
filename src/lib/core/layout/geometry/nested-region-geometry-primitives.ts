import type { Bounds, Point } from '../layout-types';

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
