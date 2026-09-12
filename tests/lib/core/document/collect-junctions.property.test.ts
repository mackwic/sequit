import fc from 'fast-check';
import { expect, it } from 'vitest';

import { collectJunctions } from '../../../../src/lib/core/document/collect-junctions';
import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';

it('collects both sides of any cut in a chain and is idempotent without mutating the input', async () => {
	await fc.assert(
		fc.asyncProperty(fc.integer({ min: 1, max: 40 }), fc.nat(), async (length, cut) => {
			const ids = Array.from({ length }, (_, index) => `j${index}`);
			const layout = await layoutNodes({
				...junctionFixtures.chain(LayoutDirection.TopToBottom, ids).build(),
				direction: LayoutDirection.TopToBottom,
				edit: {},
			});
			const document = defined(layout.document);
			const original = structuredClone(document);
			expect(collectJunctions(document)).toBe(document);
			const broken = {
				...document,
				relations: document.relations.filter((_, index) => index !== cut % (length + 1)),
			};
			const collected = collectJunctions(broken);
			expect(collected.junctions).toEqual([]);
			expect(collected.relations).toEqual([]);
			expect(collected.nodes).toBe(document.nodes);
			expect(collectJunctions(collected)).toBe(collected);
			expect(document).toEqual(original);
		}),
		PROPERTY_PARAMETERS,
	);
});
