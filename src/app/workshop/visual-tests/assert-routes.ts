import type { LayoutRelation } from '../../../lib/core/layout/layout-types';
import { routeCrossings, routeSegments } from './route-geometry';

interface RoutesAssertions {
	haveNoOverlap(): void;
	haveNoCrossing(): void;
	haveCrossing(): void;
	haveNoOverlapWith(other: readonly LayoutRelation[]): void;
	haveNoCrossingWith(other: readonly LayoutRelation[]): void;
}

function noOverlap(routes: readonly LayoutRelation[], other: readonly LayoutRelation[]): void {
	for (const a of routes.flatMap(routeSegments)) {
		for (const b of other.flatMap(routeSegments)) {
			if (a.routeId === b.routeId || a.axis !== b.axis || a.fixed !== b.fixed) continue;
			const length = Math.min(a.end, b.end) - Math.max(a.start, b.start);
			if (length > 0)
				throw new Error(`Routes "${a.routeId}" and "${b.routeId}" overlap: length=${length}.`);
		}
	}
}

function validate(routes: readonly LayoutRelation[], minimum: number): void {
	if (routes.length < minimum) throw new Error(`Expected at least ${minimum} routes.`);
	if (new Set(routes.map(({ id }) => id)).size !== routes.length)
		throw new Error('Route identifiers must be unique.');
	routes.forEach(routeSegments);
}

/** VL-415/417: overlap describes geometry, without inferring an intentional shared trunk. */
export function AssertRoutes(routes: readonly LayoutRelation[]): RoutesAssertions {
	validate(routes, 2);
	return {
		haveNoOverlap() {
			noOverlap(routes, routes);
		},
		haveNoCrossing() {
			if (routeCrossings(routes).length > 0) throw new Error('Expected routes without crossings.');
		},
		haveCrossing() {
			if (routeCrossings(routes).length === 0)
				throw new Error('Expected a crossing between routes.');
		},
		haveNoOverlapWith(other) {
			validate(other, 1);
			validate([...routes, ...other], 2);
			noOverlap(routes, other);
		},
		haveNoCrossingWith(other) {
			validate(other, 1);
			validate([...routes, ...other], 2);
			const ids = new Set(routes.map(({ id }) => id));
			const crossings = routeCrossings([...routes, ...other]).filter(
				({ horizontalId, verticalId }) => ids.has(horizontalId) !== ids.has(verticalId),
			);
			if (crossings.length > 0)
				throw new Error('Expected no crossing between the route collections.');
		},
	};
}
