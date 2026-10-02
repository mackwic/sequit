import { expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutDocument, type LayoutFixture } from '../../../support/harnesses/layout';
import { referenceShellBandViolations } from './group-shell-band-oracle';
import { reviewedShellSample } from './group-shell-review-fixture';

function assertShellInvariants(prepared: LayoutFixture, example: string): void {
	const { document, layout } = prepared;
	expect(
		referenceShellBandViolations(
			layout.relations,
			layout.elements,
			new Set(document.groups.map(({ id }) => id)),
		),
		example,
	).toEqual([]);
	expect(validateDedicatedCandidate(prepared).valid, example).toBe(true);
}

it.each([undefined, 36])(
	'keeps the reviewed 600-document corpus valid with independently measured shared strips at padding %s',
	async (padding) => {
		for (let seed = 1; seed <= 600; seed += 1)
			for (const direction of Object.values(LayoutDirection)) {
				const { document, overrides } = reviewedShellSample(seed, direction, padding);
				const prepared = await layoutDocument(document, overrides);
				assertShellInvariants(prepared, `${seed} ${direction}`);
			}
	},
	60_000,
);
