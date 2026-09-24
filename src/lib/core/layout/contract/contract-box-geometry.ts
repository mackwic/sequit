import type { Bounds } from '../layout-types';

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
