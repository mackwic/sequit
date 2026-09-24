import type { Point } from '../layout-types';

/** True when the value lies strictly between the two bounds, in either order. */
export function strictlyBetween(value: number, first: number, second: number): boolean {
	return value > Math.min(first, second) && value < Math.max(first, second);
}

/**
 * The strict perpendicular crossing rule, shared by the bridge oracle, the routing cost, the
 * independent adjacent search and the visual assertions: the crossing point is strictly interior to
 * both segments, so a contact at a port, a bend or a run endpoint is not a crossing. Returns the
 * crossing point, or `undefined` when the two segments only touch or are parallel.
 */
export function strictCrossing(a: Point, b: Point, c: Point, d: Point): Point | undefined {
	if (a.x === b.x && c.y === d.y) {
		if (strictlyBetween(a.x, c.x, d.x) && strictlyBetween(c.y, a.y, b.y)) return { x: a.x, y: c.y };
		return undefined;
	}
	if (a.y === b.y && c.x === d.x) {
		if (strictlyBetween(c.x, a.x, b.x) && strictlyBetween(a.y, c.y, d.y)) return { x: c.x, y: a.y };
		return undefined;
	}
	return undefined;
}
