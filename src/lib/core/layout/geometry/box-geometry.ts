import type { Bounds, Point } from '../layout-types';

export function finitePositiveBounds(box: Bounds): boolean {
	if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return false;
	return box.width > 0 && box.height > 0;
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
	const aRight = a.x + a.width;
	const bRight = b.x + b.width;
	const aBottom = a.y + a.height;
	const bBottom = b.y + b.height;
	const horizontal = a.x < bRight && aRight > b.x;
	const vertical = a.y < bBottom && aBottom > b.y;
	return horizontal && vertical;
}

export function strictlyWithin(value: number, start: number, size: number): boolean {
	const end = start + size;
	return value > start && value < end;
}

function overlapsOpen(first: number, second: number, start: number, size: number): boolean {
	const low = Math.min(first, second);
	const high = Math.max(first, second);
	const end = start + size;
	return high > start && low < end;
}

/** The caller proves that the segment is orthogonal before querying box interiors. */
export function segmentEntersInterior(first: Point, second: Point, box: Bounds): boolean {
	if (first.x === second.x) {
		if (!strictlyWithin(first.x, box.x, box.width)) return false;
		return overlapsOpen(first.y, second.y, box.y, box.height);
	}
	if (!strictlyWithin(first.y, box.y, box.height)) return false;
	return overlapsOpen(first.x, second.x, box.x, box.width);
}
