import fc from 'fast-check';
import { expect, it } from 'vitest';

import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import type { RoutedPath } from '../../../../src/lib/core/layout/bridges/route-runs';
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
