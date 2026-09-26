import { disallowedRouteContacts } from '../../../src/lib/core/layout/bridges/bridge-contact';
import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';
import { assertAllowedRouteSharing } from './allowed-route-sharing';
import { VisualAssertionError } from './assertion-error';
import { routeCrossings, routeSegments } from './route-geometry';

interface RoutesAssertions {
	haveOnlyAllowedSharedTrunks(
		context?: readonly LayoutRelation[],
		sharedTargets?: ReadonlySet<string>,
	): RoutesAssertions;
	haveNoOverlap(): RoutesAssertions;
	haveNoCrossing(): RoutesAssertions;
	haveNoForbiddenContacts(): RoutesAssertions;
	haveCrossing(): RoutesAssertions;
	haveNoOverlapWith(other: readonly LayoutRelation[]): RoutesAssertions;
	haveNoCrossingWith(other: readonly LayoutRelation[]): RoutesAssertions;
}

function noOverlap(routes: readonly LayoutRelation[], other: readonly LayoutRelation[]): void {
	for (const a of routes.flatMap(routeSegments)) {
		for (const b of other.flatMap(routeSegments)) {
			if (a.routeId === b.routeId || a.axis !== b.axis || a.fixed !== b.fixed) continue;
			const length = Math.min(a.end, b.end) - Math.max(a.start, b.start);
			if (length > 0)
				throw new VisualAssertionError(
					'Recouvrement de routes',
					0,
					length,
					{ routes: [a.routeId, b.routeId] },
					{
						code: 'routes.overlap',
						message: `Routes "${a.routeId}" and "${b.routeId}" overlap: length=${length}.`,
					},
				);
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
	validate(routes, 1);
	const assertions: RoutesAssertions = {
		haveOnlyAllowedSharedTrunks(context = routes, sharedTargets) {
			validate(context, 1);
			assertAllowedRouteSharing(routes, context, sharedTargets);
			return assertions;
		},
		haveNoOverlap() {
			validate(routes, 2);
			noOverlap(routes, routes);
			return assertions;
		},
		haveNoCrossing() {
			validate(routes, 2);
			const crossings = routeCrossings(routes);
			if (crossings.length > 0)
				throw new VisualAssertionError(
					'Croisements entre les routes',
					0,
					crossings.length,
					{
						routes: [
							...new Set(
								crossings.flatMap(({ horizontalId, verticalId }) => [horizontalId, verticalId]),
							),
						],
					},
					{ code: 'routes.crossing', message: 'Expected routes without crossings.' },
				);
			return assertions;
		},
		haveNoForbiddenContacts() {
			validate(routes, 2);
			for (const [index, first] of routes.entries())
				for (const second of routes.slice(index + 1)) {
					const contacts = disallowedRouteContacts(first, second, []);
					if (contacts.length > 0)
						throw new VisualAssertionError('Contacts entre routes sans pont', 0, contacts.length, {
							routes: [first.id, second.id],
						});
				}
			return assertions;
		},
		haveCrossing() {
			validate(routes, 2);
			if (routeCrossings(routes).length === 0)
				throw new VisualAssertionError(
					'Croisements entre les routes',
					'au moins un croisement',
					0,
					{ routes: routes.map(({ id }) => id) },
					{ code: 'routes.crossing', message: 'Expected a crossing between routes.' },
				);
			return assertions;
		},
		haveNoOverlapWith(other) {
			validate(other, 1);
			validate([...routes, ...other], 2);
			noOverlap(routes, other);
			return assertions;
		},
		haveNoCrossingWith(other) {
			validate(other, 1);
			validate([...routes, ...other], 2);
			const ids = new Set(routes.map(({ id }) => id));
			const crossings = routeCrossings([...routes, ...other]).filter(
				({ horizontalId, verticalId }) => ids.has(horizontalId) !== ids.has(verticalId),
			);
			if (crossings.length > 0)
				throw new VisualAssertionError(
					'Croisements entre les collections',
					0,
					crossings.length,
					{
						routes: [
							...new Set(
								crossings.flatMap(({ horizontalId, verticalId }) => [horizontalId, verticalId]),
							),
						],
					},
					{
						code: 'routes.crossing',
						message: 'Expected no crossing between the route collections.',
					},
				);
			return assertions;
		},
	};
	return assertions;
}
