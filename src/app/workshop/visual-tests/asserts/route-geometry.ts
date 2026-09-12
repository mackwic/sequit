import type { LayoutRelation, Point } from '../../../../lib/core/layout/layout-types';

export interface RouteSegment {
	readonly routeId: string;
	readonly axis: 'x' | 'y';
	readonly fixed: number;
	readonly start: number;
	readonly end: number;
}

/** VL-401/409: normalize collinear points into runs before observing intersections. */
export function routeSegments(route: LayoutRelation): readonly RouteSegment[] {
	const points: Point[] = [];
	for (const point of route.points) {
		if (![point.x, point.y].every(Number.isFinite))
			throw new Error(`Route "${route.id}" has non-finite coordinates.`);
		const previous = points.at(-1);
		if (previous?.x === point.x && previous.y === point.y) continue;
		points.push(point);
	}
	const segments: RouteSegment[] = [];
	for (const [index, point] of points.entries()) {
		const previous = points[index - 1];
		if (previous === undefined) continue;
		let axis: 'x' | 'y' = 'x';
		if (previous.y !== point.y) {
			if (previous.x !== point.x) throw new Error(`Route "${route.id}" must be orthogonal.`);
			axis = 'y';
		}
		let fixed = point.y;
		if (axis === 'y') fixed = point.x;
		const start = Math.min(previous[axis], point[axis]);
		const end = Math.max(previous[axis], point[axis]);
		const last = segments.at(-1);
		if (last?.axis === axis && last.fixed === fixed) {
			segments.pop();
			segments.push({
				routeId: route.id,
				axis,
				fixed,
				start: Math.min(last.start, start),
				end: Math.max(last.end, end),
			});
		} else segments.push({ routeId: route.id, axis, fixed, start, end });
	}
	if (segments.length === 0) throw new Error(`Route "${route.id}" has no route.`);
	return segments;
}

export interface RouteCrossing extends Point {
	readonly horizontalId: string;
	readonly verticalId: string;
}

/** Proper transverse intersections only: a contact at a run endpoint is not a crossing. */
export function routeCrossings(routes: readonly LayoutRelation[]): readonly RouteCrossing[] {
	const segments = routes.flatMap(routeSegments);
	const crossings = new Map<string, RouteCrossing>();
	for (const horizontal of segments.filter(({ axis }) => axis === 'x')) {
		for (const vertical of segments.filter(({ axis }) => axis === 'y')) {
			if (horizontal.routeId === vertical.routeId) continue;
			const x = vertical.fixed;
			const y = horizontal.fixed;
			if (x <= horizontal.start || x >= horizontal.end || y <= vertical.start || y >= vertical.end)
				continue;
			const crossing = { x, y, horizontalId: horizontal.routeId, verticalId: vertical.routeId };
			crossings.set(JSON.stringify(crossing), crossing);
		}
	}
	return [...crossings.values()];
}
