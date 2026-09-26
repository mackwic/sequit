import type { Bounds, Point } from './layout-types';

export function cross(point: Point, vertical: boolean): number {
	if (vertical) return point.x;
	return point.y;
}

export function longitudinal(point: Point, vertical: boolean): number {
	if (vertical) return point.y;
	return point.x;
}

export function crossStart(bounds: Bounds, vertical: boolean): number {
	if (vertical) return bounds.x;
	return bounds.y;
}

export function crossEnd(bounds: Bounds, vertical: boolean): number {
	if (vertical) return bounds.x + bounds.width;
	return bounds.y + bounds.height;
}

export function longStart(bounds: Bounds, vertical: boolean): number {
	if (vertical) return bounds.y;
	return bounds.x;
}

export function longEnd(bounds: Bounds, vertical: boolean): number {
	if (vertical) return bounds.y + bounds.height;
	return bounds.x + bounds.width;
}

export function finiteBounds(bounds: Bounds): boolean {
	const coordinates = [bounds.x, bounds.y, bounds.width, bounds.height];
	if (!coordinates.every(Number.isFinite)) return false;
	return bounds.width > 0 && bounds.height > 0;
}

export function inside(inner: Bounds, outer: Bounds): boolean {
	const left = inner.x >= outer.x;
	const right = inner.x + inner.width <= outer.x + outer.width;
	const top = inner.y >= outer.y;
	const bottom = inner.y + inner.height <= outer.y + outer.height;
	const horizontal = left && right;
	const vertical = top && bottom;
	return horizontal && vertical;
}

export function overlapping(a: Bounds, b: Bounds): boolean {
	const left = a.x < b.x + b.width;
	const right = a.x + a.width > b.x;
	const top = a.y < b.y + b.height;
	const bottom = a.y + a.height > b.y;
	const horizontal = left && right;
	const vertical = top && bottom;
	return horizontal && vertical;
}

function between(value: number, first: number, second: number): boolean {
	return value >= Math.min(first, second) && value <= Math.max(first, second);
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
	return between(point.x, start.x, end.x) && between(point.y, start.y, end.y);
}

/** Only for nonadjacent segments of the same route; route pairs use bridge-contact. */
export function segmentsSelfContact(a: Point, b: Point, c: Point, d: Point): boolean {
	const firstVertical = a.x === b.x;
	const secondVertical = c.x === d.x;
	if (firstVertical && !secondVertical) {
		const point = { x: a.x, y: c.y };
		return pointOnSegment(point, a, b) && pointOnSegment(point, c, d);
	}
	if (!firstVertical && secondVertical) {
		const point = { x: c.x, y: a.y };
		return pointOnSegment(point, a, b) && pointOnSegment(point, c, d);
	}
	if (firstVertical && a.x !== c.x) return false;
	if (!firstVertical && a.y !== c.y) return false;
	let aStart = Math.min(a.x, b.x);
	let aEnd = Math.max(a.x, b.x);
	let bStart = Math.min(c.x, d.x);
	let bEnd = Math.max(c.x, d.x);
	if (firstVertical) {
		aStart = Math.min(a.y, b.y);
		aEnd = Math.max(a.y, b.y);
		bStart = Math.min(c.y, d.y);
		bEnd = Math.max(c.y, d.y);
	}
	return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
}

export function hitsBox(start: Point, end: Point, bounds: Bounds, clearance: number): boolean {
	const left = bounds.x - clearance;
	const right = bounds.x + bounds.width + clearance;
	const top = bounds.y - clearance;
	const bottom = bounds.y + bounds.height + clearance;
	if (start.x === end.x) {
		const crossesX = start.x > left && start.x < right;
		const crossesY = Math.max(start.y, end.y) > top && Math.min(start.y, end.y) < bottom;
		return crossesX && crossesY;
	}
	const crossesY = start.y > top && start.y < bottom;
	const crossesX = Math.max(start.x, end.x) > left && Math.min(start.x, end.x) < right;
	return crossesY && crossesX;
}

export function finiteOrthogonalSegment(start: Point, end: Point): boolean {
	const finite = [start.x, start.y, end.x, end.y].every(Number.isFinite);
	if (!finite) return false;
	const vertical = start.x === end.x;
	const horizontal = start.y === end.y;
	return vertical !== horizontal;
}
