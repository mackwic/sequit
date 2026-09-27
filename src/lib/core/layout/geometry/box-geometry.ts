import { LayoutDirection } from '../../document/logic-document';
import type { Bounds, LayoutRelation, Point } from '../layout-types';

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
export function routePathBounds(route: LayoutRelation): Bounds {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const point of route.points) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function routeBoundsOverlap(first: Bounds, second: Bounds): boolean {
	const firstRight = first.x + first.width;
	const secondRight = second.x + second.width;
	const horizontalOverlap = first.x <= secondRight && firstRight >= second.x;
	const firstBottom = first.y + first.height;
	const secondBottom = second.y + second.height;
	const verticalOverlap = first.y <= secondBottom && firstBottom >= second.y;
	return horizontalOverlap && verticalOverlap;
}

export function onPrincipalFace(
	point: Point,
	box: Bounds,
	direction: LayoutDirection,
	source: boolean,
): boolean {
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop) {
		let faceY = box.y;
		if (direction === LayoutDirection.TopToBottom && !source) faceY += box.height;
		if (direction === LayoutDirection.BottomToTop && source) faceY += box.height;
		return point.y === faceY && strictlyWithin(point.x, box.x, box.width);
	}
	let faceX = box.x;
	if (direction === LayoutDirection.LeftToRight && !source) faceX += box.width;
	if (direction === LayoutDirection.RightToLeft && source) faceX += box.width;
	return point.x === faceX && strictlyWithin(point.y, box.y, box.height);
}

function strictlyWithin(value: number, start: number, size: number): boolean {
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
