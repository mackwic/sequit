import { defined } from '../../document/logic-document';
import { disallowedRouteContacts } from '../bridges/bridge-contact';
import type { RouteBridgeAnalysis } from '../bridges/bridge-oracle';
import { validateSelfContacts } from '../bridges/route-self-contacts';
import { routeBoundsOverlap, routePathBounds } from '../geometry/box-geometry';
import type { LayoutRelation } from '../layout-types';
import type { RejectedDedicatedCandidate } from './types';
import { DedicatedCandidateRejectionCode, rejected } from './types';

export function contactFailure(
	routes: readonly LayoutRelation[],
	analysis: RouteBridgeAnalysis,
): RejectedDedicatedCandidate | undefined {
	const envelopes = routes.map(routePathBounds);
	for (let firstIndex = 0; firstIndex < routes.length; firstIndex += 1) {
		const first = defined(routes[firstIndex]);
		if (!validateSelfContacts(first))
			return rejected(DedicatedCandidateRejectionCode.SelfContact, undefined, first.id);
		for (let secondIndex = firstIndex + 1; secondIndex < routes.length; secondIndex += 1) {
			const second = defined(routes[secondIndex]);
			if (!routeBoundsOverlap(defined(envelopes[firstIndex]), defined(envelopes[secondIndex])))
				continue;
			const invalidContact = disallowedRouteContacts(first, second, analysis.bridges)[0];
			if (invalidContact === undefined) continue;
			return {
				valid: false,
				code: DedicatedCandidateRejectionCode.RouteContact,
				relationId: first.id,
				otherRelationId: second.id,
				contact: invalidContact.from,
			};
		}
	}
	return undefined;
}
