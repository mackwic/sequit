import type { LayoutRelation, Point } from '../../../src/lib/core/layout/layout-types';
import { identityOf, validateBox } from '../harnesses/box-geometry';
import type { BoxGeometry } from './assert-box';
import { VisualAssertionError } from './assertion-error';
import { routeSegments } from './route-geometry';
import { extent, minimumMetric } from './routing-measurements';

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
	staysWithin(boundary: BoxGeometry, options: { readonly axis: 'x' | 'y' }): RouteAssertions;
	usesCorridorBetween(
		before: BoxGeometry,
		after: BoxGeometry,
		options: { readonly axis: 'x' | 'y'; readonly clearance: number },
	): RouteAssertions;
	usesPositiveSideOf(
		obstacle: BoxGeometry,
		options: { readonly axis: 'x' | 'y'; readonly clearance: number },
	): RouteAssertions;
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
		staysWithin(boundary, { axis }) {
			validateBox(boundary);
			routeSegments(route);
			const start = boundary.bounds[axis];
			const end = start + extent(boundary.bounds, axis);
			for (const point of route.points)
				minimumMetric(
					`Route "${route.id}" dans l’enveloppe sur ${axis}`,
					Math.min(point[axis] - start, end - point[axis]),
					0,
					{ routes: [route.id], referenceBoxes: identityOf(boundary).ids },
				);
			return assertions;
		},
		usesCorridorBetween(before, after, { axis, clearance }) {
			validateBox(before);
			validateBox(after);
			if (!Number.isFinite(clearance) || clearance < 0)
				throw new Error('Corridor clearance must be finite and non-negative.');
			const referenceBoxes = [...identityOf(before).ids, ...identityOf(after).ids];
			const start = before.bounds[axis] + extent(before.bounds, axis) + clearance;
			const end = after.bounds[axis] - clearance;
			if (end < start)
				throw new VisualAssertionError(
					`Corridor entre "${before.id}" et "${after.id}" sur ${axis}`,
					`largeur minimale=${clearance * 2}`,
					Math.max(0, after.bounds[axis] - before.bounds[axis] - extent(before.bounds, axis)),
					{
						routes: [route.id],
						referenceBoxes,
					},
				);
			let passageAxis: 'x' | 'y' = 'y';
			if (axis === 'y') passageAxis = 'x';
			const coordinates = [
				...new Set(
					routeSegments(route)
						.filter((segment) => segment.axis === passageAxis)
						.map(({ fixed }) => fixed),
				),
			];
			if (!coordinates.some((coordinate) => coordinate >= start && coordinate <= end)) {
				let actual = coordinates.join(', ');
				if (coordinates.length === 0) actual = 'aucun passage';
				throw new VisualAssertionError(
					`Route "${route.id}" · colonne entre les clusters`,
					`un passage sur ${passageAxis} entre ${start} et ${end}`,
					actual,
					{
						routes: [route.id],
						referenceBoxes,
					},
				);
			}
			return assertions;
		},
		usesPositiveSideOf(obstacle, { axis, clearance }) {
			validateBox(obstacle);
			if (!Number.isFinite(clearance) || clearance < 0)
				throw new Error('Side clearance must be finite and non-negative.');
			let passageAxis: 'x' | 'y' = 'y';
			if (axis === 'y') passageAxis = 'x';
			const minimum = obstacle.bounds[axis] + extent(obstacle.bounds, axis) + clearance;
			const coordinates = routeSegments(route)
				.filter((segment) => segment.axis === passageAxis)
				.map(({ fixed }) => fixed);
			if (!coordinates.some((coordinate) => coordinate >= minimum))
				throw new VisualAssertionError(
					`Route "${route.id}" · côté positif de ${obstacle.id}`,
					`un passage sur ${passageAxis} à partir de ${minimum}`,
					coordinates.join(', ') || 'aucun passage',
					{ routes: [route.id], referenceBoxes: identityOf(obstacle).ids },
				);
			return assertions;
		},
	};
	return assertions;
}
