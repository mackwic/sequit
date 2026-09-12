import type { LayoutRelation, Point } from '../../../lib/core/layout/layout-types';
import type { BoxGeometry } from './assert-box';
import { VisualAssertionError } from './assertion-error';
import { routeSegments } from './route-geometry';

function onBoundary(point: Point | undefined, box: BoxGeometry): boolean {
	const { x, y, width, height } = box.bounds;
	if (
		point === undefined ||
		![x, y, width, height].every(Number.isFinite) ||
		width <= 0 ||
		height <= 0
	)
		return false;
	return (
		((point.x === x || point.x === x + width) && point.y >= y && point.y <= y + height) ||
		((point.y === y || point.y === y + height) && point.x >= x && point.x <= x + width)
	);
}

interface RouteAssertions {
	isOrthogonal(): RouteAssertions;
	isStraightAlong(axis: 'x' | 'y'): RouteAssertions;
	isAttachedTo(source: BoxGeometry, target: BoxGeometry): RouteAssertions;
}

/** VL-401/517: calculated route geometry and attachment to the intended endpoint contours. */
export function AssertRoute(route: LayoutRelation): RouteAssertions {
	const assertions: RouteAssertions = {
		isOrthogonal() {
			routeSegments(route);
			return assertions;
		},
		isStraightAlong(axis) {
			const segments = routeSegments(route);
			if (segments.length !== 1 || segments[0]?.axis !== axis)
				throw new VisualAssertionError(
					`Route "${route.id}" · tracé rectiligne`,
					`un segment rectiligne sur ${axis}`,
					`${segments.length} segments (axes : ${segments.map((segment) => segment.axis).join(', ')})`,
					{ routes: [route.id] },
				);
			return assertions;
		},
		isAttachedTo(source, target) {
			if (route.from !== source.id || !onBoundary(route.points.at(0), source))
				throw new Error(`Route "${route.id}" is not attached to source "${source.id}".`);
			if (route.to !== target.id || !onBoundary(route.points.at(-1), target))
				throw new Error(`Route "${route.id}" is not attached to target "${target.id}".`);
			return assertions;
		},
	};
	return assertions;
}
