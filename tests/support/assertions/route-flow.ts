import { defined, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';
import { axesFor } from '../harnesses/visual-directions';
import type { VisualLayout } from '../harnesses/visual-layout';
import { AssertRoute } from './assert-route';
import { VisualAssertionError } from './assertion-error';
import { routeSegments } from './route-geometry';
import { equalMetric, extent } from './routing-measurements';

/** Ordinary causal arrows run opposite to increasing layout ranks, between principal faces. */
export function assertRouteFlow(layout: VisualLayout, route: LayoutRelation): void {
	const axis = axesFor(layout.direction).primary;
	const decreasing = [LayoutDirection.TopToBottom, LayoutDirection.LeftToRight].includes(
		layout.direction,
	);
	const source = layout.getById(route.from);
	const target = layout.getById(route.to);
	AssertRoute(route).isAttachedTo(source, target);
	let departure = source.bounds[axis] + extent(source.bounds, axis);
	let arrival = target.bounds[axis];
	let sign = 1;
	if (decreasing) {
		departure = source.bounds[axis];
		arrival = target.bounds[axis] + extent(target.bounds, axis);
		sign = -1;
	}
	const targets = { routes: [route.id], boxes: [route.from, route.to] };
	equalMetric(
		'Face de départ sur l’axe principal',
		defined(route.points.at(0))[axis],
		departure,
		targets,
	);
	equalMetric(
		'Face d’arrivée sur l’axe principal',
		defined(route.points.at(-1))[axis],
		arrival,
		targets,
	);
	const segments = routeSegments(route);
	if (segments[0]?.axis !== axis || segments.at(-1)?.axis !== axis)
		throw new VisualAssertionError(
			'Attache sur l’axe principal',
			axis,
			'segment transversal',
			targets,
		);
	for (let index = 1; index < route.points.length; index += 1) {
		const delta = defined(route.points[index])[axis] - defined(route.points[index - 1])[axis];
		if (delta * sign < 0)
			throw new VisualAssertionError(
				'Progression de la flèche',
				'sans retour en arrière',
				delta,
				targets,
			);
	}
}
