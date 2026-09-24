import type { Point } from './layout-types';
import { samePoint } from './nested-region-geometry-primitives';

interface Contact {
	readonly from: Point;
	readonly to: Point;
}

function overlap(
	firstStart: number,
	firstEnd: number,
	secondStart: number,
	secondEnd: number,
): readonly [number, number] | undefined {
	const start = Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd));
	const end = Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd));
	if (start > end) return undefined;
	return [start, end];
}

function verticalContact(a: Point, b: Point, c: Point, d: Point): Contact | undefined {
	if (a.x !== c.x) return undefined;
	const range = overlap(a.y, b.y, c.y, d.y);
	if (range === undefined) return undefined;
	return { from: { x: a.x, y: range[0] }, to: { x: a.x, y: range[1] } };
}

function horizontalContact(a: Point, b: Point, c: Point, d: Point): Contact | undefined {
	if (a.y !== c.y) return undefined;
	const range = overlap(a.x, b.x, c.x, d.x);
	if (range === undefined) return undefined;
	return { from: { x: range[0], y: a.y }, to: { x: range[1], y: a.y } };
}

function perpendicularContact(
	verticalStart: Point,
	verticalEnd: Point,
	horizontalStart: Point,
	horizontalEnd: Point,
): Contact | undefined {
	const vertical = overlap(verticalStart.y, verticalEnd.y, horizontalStart.y, horizontalStart.y);
	const horizontal = overlap(horizontalStart.x, horizontalEnd.x, verticalStart.x, verticalStart.x);
	if (vertical === undefined || horizontal === undefined) return undefined;
	const point = { x: verticalStart.x, y: horizontalStart.y };
	return { from: point, to: point };
}

function segmentContact(a: Point, b: Point, c: Point, d: Point): Contact | undefined {
	const firstVertical = a.x === b.x;
	const secondVertical = c.x === d.x;
	if (firstVertical && secondVertical) return verticalContact(a, b, c, d);
	if (!firstVertical && !secondVertical) return horizontalContact(a, b, c, d);
	if (firstVertical) return perpendicularContact(a, b, c, d);
	return perpendicularContact(c, d, a, b);
}

/** A shared node-face endpoint is a node connection; every other contact needs a bridge. */
export function pathsTouchWithoutBridge(
	incident: readonly Point[],
	local: readonly Point[],
	allowedNodeConnection?: Point,
): boolean {
	for (let first = 1; first < incident.length; first += 1) {
		const a = incident[first - 1];
		const b = incident[first];
		if (a === undefined || b === undefined) return true;
		for (let second = 1; second < local.length; second += 1) {
			const c = local[second - 1];
			const d = local[second];
			if (c === undefined || d === undefined) return true;
			const contact = segmentContact(a, b, c, d);
			if (contact === undefined) continue;
			if (
				allowedNodeConnection !== undefined &&
				samePoint(contact.from, allowedNodeConnection) &&
				samePoint(contact.to, allowedNodeConnection)
			)
				continue;
			return true;
		}
	}
	return false;
}
