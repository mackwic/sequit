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

describe('junction channel frame shells', () => {
	it('keeps a frame ending on a junction rail clear of the frame starting on the next rank', () => {
		// g2 ends on j0's rail; g1 starts on the next rank, and its header faces that rail's slot.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Bottom },
				nodes: [
					['n0', node, 'g1'],
					['n2', node],
					['n3', node],
					['n4', { width: 100, height: 40 }, 'g2'],
				],
				junctions: [['j0', 'g2']],
				groups: [
					['g1', measurement(254, 155, 34, 16)],
					['g2', measurement(183, 145, 15, 18)],
				],
				relations: [
					['g1', 'g2'],
					['n2', 'n4'],
					['n3', 'g2'],
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

/** Frames of rigid blocks and their junction rails, placed without any later separation. */
describe('group frames around junction rails', () => {
	const small = { width: 80, height: 40 };
	const thin = measurement(100, 60, 8, 8);
	const top = { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top } as const;

	it('keeps a junction-only frame clear of a one-rank frame overflowing toward its rail', () => {
		// g2 grows to 113 below n1; g1 holds only j0 and starts on the rail g2 faces.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small, 'g0'],
					['n1', small, 'g2'],
				],
				junctions: [['j0', 'g1']],
				groups: [
					['g0', thin],
					['g1', thin, 'g0'],
					['g2', measurement(100, 113, 8, 8), 'g0'],
				],
				relations: [['g1', 'g2']],
			}),
		).toMatchObject({ valid: true });
	});

	it('starts a frame on its rail when its only ranked member is a junction-only group', () => {
		// g2 is related but holds only j0: g0's header belongs to j0's rail slot, not to rank 0.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small, 'g0'],
					['n1', small, 'g0'],
					['n2', small, 'g0'],
					['n3', small, 'g1'],
				],
				junctions: [
					['j0', 'g2'],
					['j1', 'g0'],
				],
				groups: [
					['g0', measurement(100, 60, 22, 27)],
					['g1', thin],
					['g2', thin, 'g0'],
				],
				relations: [
					['g0', 'g1'],
					['j1', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('places the free groups of a junction-only frame beside its junction', () => {
		// g1 holds nothing ranked; g0 holds it beside j0 instead of after every component.
		expect(
			layoutWitness({
				layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
				nodes: [
					['n0', small],
					['n1', small],
					['n2', small],
					['n3', small],
				],
				junctions: [['j0', 'g0']],
				groups: [
					['g0', thin],
					['g1', thin, 'g0'],
				],
				relations: [['n0', 'g0']],
			}),
		).toMatchObject({ valid: true });
	});

	it('walls a block in the rank its frame crosses to reach a junction rail', () => {
		// g0 holds g2 on rank 0 and j0, j1 on the rail after rank 1, where g1 stands.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small],
					['n1', small],
					['n2', small, 'g1'],
					['n3', small],
					['n4', small],
				],
				junctions: [
					['j0', 'g0'],
					['j1', 'g0'],
				],
				groups: [
					['g0', thin],
					['g1', thin],
					['g2', thin, 'g0'],
				],
				relations: [
					['n2', 'g2'],
					['g0', 'g1'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('keeps a related group holding only a related group out of the blocks', () => {
		// g1's relations end on g1 itself, so it keeps a row slot around g2, inside block g0.
		expect(
			layoutWitness({
				layout: top,
				nodes: ['n0', 'n1', 'n2', 'n3', 'n4'].map((id) => [id, small, 'g0'] as const),
				junctions: [['j0', 'g0']],
				groups: [
					['g0', thin],
					['g1', thin, 'g0'],
					['g2', thin, 'g1'],
				],
				relations: [
					['n0', 'g1'],
					['n0', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('searches a component with the blocks of the whole document', () => {
		// g0's own relation lies in another component: locally g0 would become a block.
		expect(
			layoutWitness({
				layout: top,
				nodes: [
					['n0', small, 'g1'],
					['n1', small],
					['n2', small, 'g1'],
					['n3', small],
					['n4', small],
					['n5', small],
				],
				groups: [
					['g0', thin],
					['g1', thin],
					['g2', thin, 'g0'],
				],
				relations: [
					['n4', 'g0'],
					['n0', 'n1'],
					['n2', 'n5'],
					['n5', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});
