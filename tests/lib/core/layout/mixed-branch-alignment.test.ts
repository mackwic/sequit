import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { scenario } from '../../../scenarios/visual/routing/mixed-branch-alignment.scenario';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { mixedBranchAlignment } from '../../../support/fixtures/mixed-branch-alignment';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';

describe.each(LAYOUT_CONFIGURATIONS)(
	'mixed branch alignment in $direction / $bias',
	({ direction, bias }) => {
		it('aligns both marked routes while preserving documentary order and the upper fork', async () => {
			const layout = await scenario.arrange(direction, bias);
			scenario.assert(layout);
			const fixture = mixedBranchAlignment(direction);
			const reordered = await layoutNodes({
				...fixture,
				direction,
				bias,
				relations: fixture.relations.toReversed(),
			});
			expect(reordered).toEqual(layout);
		});
	},
);

it('retains both feasible anchors for varied widths and relation permutations', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...LAYOUT_CONFIGURATIONS),
			fc.integer({ min: 196, max: 244 }),
			fc.integer({ min: 136, max: 184 }),
			fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7], { minLength: 8, maxLength: 8 }),
			async ({ direction, bias }, content, narrow, permutation) => {
				const fixture = mixedBranchAlignment(direction, content, narrow);
				const layout = await layoutNodes({ ...fixture, direction, bias });
				scenario.assert(layout);
				const reordered = await layoutNodes({
					...fixture,
					direction,
					bias,
					relations: permutation.map((index) => defined(fixture.relations[index])),
				});
				expect(reordered).toEqual(layout);
			},
		),
		PROPERTY_PARAMETERS,
	);
});
