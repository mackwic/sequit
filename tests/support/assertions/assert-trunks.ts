import { defined } from '../../../src/lib/core/document/logic-document';
import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';
import { routeSegments } from './route-geometry';
import { type Axis, minimumMetric } from './routing-measurements';

/** Explicit route families only: the assertion does not decide which trunks are permitted. */
interface TrunkAssertions {
	haveSharedSegment(axis: Axis, minimumLength: number): void;
}

export function AssertTrunks(routes: readonly LayoutRelation[]): TrunkAssertions {
	if (routes.length < 2) throw new Error('Un tronc commun nécessite au moins deux routes.');
	return {
		haveSharedSegment(axis: Axis, minimumLength: number) {
			let candidates = routeSegments(defined(routes[0])).filter((segment) => segment.axis === axis);
			for (const route of routes.slice(1)) {
				candidates = candidates.flatMap((candidate) =>
					routeSegments(route)
						.filter((segment) => segment.axis === axis && segment.fixed === candidate.fixed)
						.map((segment) => ({
							...candidate,
							start: Math.max(candidate.start, segment.start),
							end: Math.min(candidate.end, segment.end),
						}))
						.filter((segment) => segment.end > segment.start),
				);
			}
			minimumMetric(
				'Longueur du tronc commun',
				Math.max(0, ...candidates.map((segment) => segment.end - segment.start)),
				minimumLength,
				{ routes: routes.map((route) => route.id) },
			);
		},
	};
}
