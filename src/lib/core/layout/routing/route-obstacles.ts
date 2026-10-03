import { defined } from '../../document/logic-document';
import type { Bounds, Point } from '../layout-types';

interface Rectangle {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

interface ObstacleNode {
	readonly box: Rectangle;
	readonly envelope: Rectangle;
	readonly before: ObstacleNode | undefined;
	readonly after: ObstacleNode | undefined;
}

export interface RouteObstacles {
	readonly root: ObstacleNode | undefined;
}

interface Segment {
	readonly vertical: boolean;
	readonly fixed: number;
	readonly start: number;
	readonly end: number;
}

function expand(box: Bounds, clearance: number): Rectangle {
	return Object.freeze({
		left: box.x - clearance,
		top: box.y - clearance,
		right: box.x + box.width + clearance,
		bottom: box.y + box.height + clearance,
	});
}

function union(left: Rectangle, right: Rectangle): Rectangle {
	return Object.freeze({
		left: Math.min(left.left, right.left),
		top: Math.min(left.top, right.top),
		right: Math.max(left.right, right.right),
		bottom: Math.max(left.bottom, right.bottom),
	});
}

function compareRectangles(left: Rectangle, right: Rectangle): number {
	for (const key of ['left', 'top', 'right', 'bottom'] as const) {
		const difference = left[key] - right[key];
		if (difference !== 0) return difference;
	}
	return 0;
}

function buildTree(
	boxes: readonly Rectangle[],
	start: number,
	end: number,
): ObstacleNode | undefined {
	if (start === end) return undefined;
	const middle = Math.floor((start + end) / 2);
	const box = defined(boxes[middle]);
	const before = buildTree(boxes, start, middle);
	const after = buildTree(boxes, middle + 1, end);
	let envelope = box;
	if (before !== undefined) envelope = union(envelope, before.envelope);
	if (after !== undefined) envelope = union(envelope, after.envelope);
	return Object.freeze({ box, envelope, before, after });
}

/** Copy the geometry into a balanced x-ordered tree; subtree envelopes prune both axes. */
export function prepareRouteObstacles(boxes: readonly Bounds[], clearance: number): RouteObstacles {
	const rectangles = boxes
		.map((box) => expand(box, clearance))
		.filter((box) => box.left < box.right && box.top < box.bottom)
		.sort(compareRectangles);
	return Object.freeze({ root: buildTree(rectangles, 0, rectangles.length) });
}

function segmentBetween(from: Point, to: Point): Segment {
	if (from.x === to.x)
		return {
			vertical: true,
			fixed: from.x,
			start: Math.min(from.y, to.y),
			end: Math.max(from.y, to.y),
		};
	if (from.y !== to.y) throw new Error('Route obstacle queries require orthogonal segments');
	return {
		vertical: false,
		fixed: from.y,
		start: Math.min(from.x, to.x),
		end: Math.max(from.x, to.x),
	};
}

function intersects(segment: Segment, rectangle: Rectangle): boolean {
	let start = rectangle.left;
	let end = rectangle.right;
	let low = rectangle.top;
	let high = rectangle.bottom;
	if (segment.vertical) {
		start = rectangle.top;
		end = rectangle.bottom;
		low = rectangle.left;
		high = rectangle.right;
	}
	const crosses = segment.start < end && segment.end > start;
	const inside = segment.fixed > low && segment.fixed < high;
	return crosses && inside;
}

function hitsTree(segment: Segment, node: ObstacleNode | undefined): boolean {
	if (node === undefined || !intersects(segment, node.envelope)) return false;
	if (intersects(segment, node.box)) return true;
	return hitsTree(segment, node.before) || hitsTree(segment, node.after);
}

/** Contact with an expanded rectangle boundary is allowed; entering its interior is not. */
export function segmentHitsObstacles(from: Point, to: Point, obstacles: RouteObstacles): boolean {
	return hitsTree(segmentBetween(from, to), obstacles.root);
}

export function routeHitsObstacles(points: readonly Point[], obstacles: RouteObstacles): boolean {
	for (let index = 1; index < points.length; index += 1) {
		const from = defined(points[index - 1]);
		const to = defined(points[index]);
		if (segmentHitsObstacles(from, to, obstacles)) return true;
	}
	return false;
}
