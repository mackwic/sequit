import fc from 'fast-check';
import { expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import { disallowedRouteContacts } from '../../../../src/lib/core/layout/bridges/bridge-contact';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import type { RoutedPath } from '../../../../src/lib/core/layout/bridges/route-runs';
import { validateSelfContacts } from '../../../../src/lib/core/layout/bridges/route-self-contacts';
import { contactFailure } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-contacts';
import {
	DedicatedCandidateRejectionCode,
	rejected,
} from '../../../../src/lib/core/layout/dedicated-candidate-validation/types';
import type { LayoutRelation } from '../../../../src/lib/core/layout/layout-types';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { referenceRouteBridgeAnalysis } from './bridge-oracle-reference';

/** Every sample has shared collinear carriers and simultaneous strict crossings. */
function carrierRouteSet(): fc.Arbitrary<readonly RoutedPath[]> {
	return fc
		.tuple(
			fc.integer({ min: 30, max: 130 }),
			fc.integer({ min: 30, max: 130 }),
			fc.integer({ min: 12, max: 35 }),
			fc.boolean(),
		)
		.map(([x, y, separation, reversed]) => {
			const routes: readonly RoutedPath[] = [
				{
					id: 'horizontal-a',
					points: [
						{ x: 0, y },
						{ x: 100, y },
						{ x: 200, y },
					],
				},
				{
					id: 'horizontal-b',
					points: [
						{ x: 200, y },
						{ x: 0, y },
					],
				},
				{
					id: 'horizontal-c',
					points: [
						{ x: 0, y: y + separation },
						{ x: 200, y: y + separation },
					],
				},
				{
					id: 'vertical-a',
					points: [
						{ x, y: 0 },
						{ x, y: 200 },
					],
				},
				{
					id: 'vertical-b',
					points: [
						{ x: x + separation, y: 0 },
						{ x: x + separation, y: 200 },
					],
				},
				{
					id: 'vertical-c',
					points: [
						{ x, y: 200 },
						{ x, y: 0 },
					],
				},
			];
			if (reversed)
				return routes.map((route) => ({ ...route, points: [...route.points].reverse() }));
			return routes;
		});
}

it('matches exhaustive crossings and full bridge carriers over route permutations', () => {
	fc.assert(
		fc.property(carrierRouteSet(), (routes) => {
			const permutations = [
				routes,
				[...routes].reverse(),
				[...routes.slice(2), ...routes.slice(0, 2)],
			];
			for (const permutation of permutations) {
				const reference = referenceRouteBridgeAnalysis(permutation);
				expect(reference.bridges.some((bridge) => bridge.carrierIds.length > 1)).toBe(true);
				expect(routeBridgeAnalysis(permutation)).toEqual(reference);
			}
		}),
		PROPERTY_PARAMETERS,
	);
});

/** Exhaustive canonical pair scan; the production index may only skip non-touching route pairs. */
function referenceContactFailure(routes: readonly LayoutRelation[]) {
	const ordered = [...routes].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	const analysis = referenceRouteBridgeAnalysis(ordered);
	for (const [firstIndex, first] of ordered.entries()) {
		if (!validateSelfContacts(first))
			return rejected(DedicatedCandidateRejectionCode.SelfContact, undefined, first.id);
		for (const second of ordered.slice(firstIndex + 1)) {
			const contact = disallowedRouteContacts(first, second, analysis.bridges)[0];
			if (contact !== undefined)
				return {
					valid: false as const,
					code: DedicatedCandidateRejectionCode.RouteContact,
					relationId: first.id,
					otherRelationId: second.id,
					contact: contact.from,
				};
		}
	}
	return undefined;
}

it('matches exhaustive route contacts and bridges on orthogonal route sets', () => {
	const coordinate = fc.integer({ min: -100, max: 100 });
	const route = fc
		.tuple(coordinate, coordinate, coordinate, coordinate, coordinate)
		.map(([startX, startY, middleX, endY, endX]) => [
			{ x: startX, y: startY },
			{ x: middleX, y: startY },
			{ x: middleX, y: endY },
			{ x: endX, y: endY },
		]);
	fc.assert(
		fc.property(fc.array(route, { minLength: 2, maxLength: 10 }), (ways) => {
			const routes: LayoutRelation[] = ways.map((points, index) => ({
				id: `relation-${index}`,
				from: `source-${index}`,
				to: `target-${index}`,
				points,
			}));
			const expected = referenceRouteBridgeAnalysis(routes);
			expect(routeBridgeAnalysis(routes)).toEqual(expected);
			expect(contactFailure(routes, expected)).toEqual(referenceContactFailure(routes));
		}),
		PROPERTY_PARAMETERS,
	);
});
