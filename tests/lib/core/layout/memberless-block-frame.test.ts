import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { measurement, placeWitness } from '../../../support/harnesses/layout-witness';

const small = { width: 80, height: 40 };
const groupPadding = 8;
const thin = measurement(100, 60, 8, groupPadding);

function bounds(id: string, layout: LayoutResult) {
	const element = layout.elements.find((candidate) => candidate.id === id);
	if (element === undefined) throw new Error(`Expected ${id} to be placed`);
	return element.bounds;
}

describe('junctions beside spanning group frames', () => {
	it('moves a junction clear of a foreign frame spanning its rail', () => {
		const placed = placeWitness({
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			nodes: [
				['n0', small, 'g0'],
				['n1', small, 'g0'],
				['n2', small, 'g0'],
			],
			junctions: [['j0', 'g1']],
			groups: [
				['g0', thin],
				['g1', thin],
			],
			relations: [
				['n0', 'n1'],
				['n1', 'n2'],
				['n0', 'j0'],
				['j0', 'n1'],
			],
		});
		const junction = bounds('j0', placed.layout);
		const frame = bounds('g0', placed.layout);
		const junctionMainEnd = junction.y + junction.height;
		const frameMainEnd = frame.y + frame.height;
		expect(junction.y).toBeGreaterThan(frame.y);
		expect(junctionMainEnd).toBeLessThan(frameMainEnd);
		const junctionEnd = junction.x + junction.width;
		const frameEnd = frame.x + frame.width;
		const beforeFrame = junctionEnd <= frame.x;
		const afterFrame = frameEnd <= junction.x;
		expect(beforeFrame || afterFrame).toBe(true);
	});

	it('keeps a member junction inside its measured block frame', () => {
		const placed = placeWitness({
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			nodes: [
				['n0', small, 'g0'],
				['n1', small],
				['n2', { width: 500, height: 40 }],
			],
			junctions: [['j0', 'g0']],
			groups: [['g0', thin]],
			relations: [
				['n0', 'j0'],
				['n2', 'j0'],
				['j0', 'n1'],
			],
		});
		const junction = bounds('j0', placed.layout);
		const frame = bounds('g0', placed.layout);
		expect(frame.width).toBe(100);
		expect(junction.x).toBeGreaterThanOrEqual(frame.x + groupPadding);
		const innerEnd = frame.x + frame.width - groupPadding;
		expect(junction.x + junction.width).toBeLessThanOrEqual(innerEnd);
	});
});
