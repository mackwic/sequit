import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { layoutWitness } from '../../../support/harnesses/layout-witness';

/** Shrunk counterexamples of the grouped document property; every size is a plain default. */
const node = { width: 100, height: 60 };

describe('junction rails', () => {
	it('places a junction without ordinary children after the junction it feeds', () => {
		// j1 sits just before n0, two ranks down; j0 feeds only j1, so its own rank cannot hold it.
		expect(
			layoutWitness({
				layout: {
					direction: LayoutDirection.BottomToTop,
					bias: LayoutBias.Top,
				},
				nodes: [
					['n0', node],
					['n1', node],
					['n2', node],
				],
				junctions: [['j0'], ['j1']],
				groups: [],
				relations: [
					['n0', 'n1'],
					['j0', 'j1'],
					['n1', 'n2'],
					['n0', 'j1'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});
