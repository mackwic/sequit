import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { layoutWitness, measurement } from '../../../support/harnesses/layout-witness';

describe('group endpoints that hold no node', () => {
	it('keeps a group holding only an empty group as its own relation endpoint', () => {
		expect(
			layoutWitness({
				layout: {
					direction: LayoutDirection.LeftToRight,
					bias: LayoutBias.Left,
				},
				nodes: [
					['n0', { width: 270, height: 150 }],
					['n1', { width: 280, height: 160 }],
					['n2', { width: 210, height: 110 }],
				],
				groups: [
					['g0', measurement(210, 60, 40, 32)],
					['g1', measurement(180, 130, 8, 28), 'g0'],
				],
				relations: [
					['n1', 'g1'],
					['n2', 'n0'],
					['n2', 'g0'],
					['n2', 'n1'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('ranks an empty subgroup whose parent group is a junction target', () => {
		expect(
			layoutWitness({
				layout: {
					direction: LayoutDirection.TopToBottom,
					bias: LayoutBias.Bottom,
				},
				nodes: [
					['n0', { width: 200, height: 160 }],
					['n1', { width: 190, height: 100 }, 'g1'],
					['n2', { width: 80, height: 100 }, 'g1'],
				],
				junctions: [['j0']],
				groups: [
					['g0', measurement(170, 160, 44, 28)],
					['g1', measurement(100, 80, 8, 12)],
					['g2', measurement(190, 120, 32, 12), 'g0'],
				],
				relations: [
					['j0', 'g0'],
					['n2', 'j0'],
					['n1', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});

	it('aligns a relation from a junction-only group on the junction it holds', () => {
		expect(
			layoutWitness({
				layout: {
					direction: LayoutDirection.TopToBottom,
					bias: LayoutBias.Top,
				},
				nodes: [
					['n0', { width: 111, height: 160 }],
					['n1', { width: 297, height: 147 }],
					['n2', { width: 188, height: 40 }, 'g2'],
					['n3', { width: 81, height: 158 }],
				],
				junctions: [['j0', 'g0']],
				groups: [
					['g0', measurement(109, 134, 48, 19)],
					['g1', measurement(102, 148, 48, 14)],
					['g2', measurement(107, 107, 9, 29), 'g1'],
				],
				relations: [
					['n0', 'g0'],
					['g0', 'g2'],
				],
			}),
		).toMatchObject({ valid: true });
	});
});
