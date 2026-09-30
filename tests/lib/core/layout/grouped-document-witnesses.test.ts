import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { layoutWitness, measurement } from '../../../support/harnesses/layout-witness';

/** Shrunk counterexamples of the grouped document property; every size is a plain default. */
const node = { width: 100, height: 60 };
const group = measurement(100, 60, 20, 16);

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

describe('channel rail constraints', () => {
	it('breaks a cycle through a column that two unrelated relations reach', () => {
		// r1 and r2 arrive at one column of the root channel, from which r0 leaves.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
				nodes: [
					['n1', node, 'g0'],
					['n2', node, 'g1'],
					['n4', node, 'g1'],
					['n5', node],
					['n6', node, 'g0'],
				],
				groups: [
					['g0', group],
					['g1', group],
				],
				relations: [
					['n5', 'g1'],
					['n2', 'g0'],
					['n1', 'n4'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('orders no straight relations sharing a column with converging arrivals', () => {
		// j0 reaches g0 and g1 straight down one column, where n4's relations to both arrive.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
				nodes: [
					['n3', node, 'g1'],
					['n4', node],
				],
				junctions: [['j0']],
				groups: [
					['g0', group],
					['g1', group, 'g0'],
				],
				relations: [
					['n4', 'g0'],
					['j0', 'g0'],
					['j0', 'g1'],
					['n4', 'g1'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});
