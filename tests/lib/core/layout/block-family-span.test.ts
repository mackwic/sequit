import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { boundsFor } from '../../../support/harnesses/layout';
import { measurement, placeWitness } from '../../../support/harnesses/layout-witness';

describe('family links across spanning blocks', () => {
	it('centers an ordinary family instead of linking to a block spanning its other endpoint', () => {
		const placed = placeWitness({
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			nodes: [
				['a', { width: 80, height: 40 }, 'g0'],
				['b', { width: 500, height: 40 }],
				['c', { width: 80, height: 40 }],
				['d', { width: 80, height: 40 }, 'g0'],
			],
			groups: [['g0', measurement(100, 60, 8, 8)]],
			relations: [
				['a', 'b'],
				['b', 'c'],
				['c', 'd'],
			],
		});
		const parent = boundsFor(placed.layout, 'b');
		const child = boundsFor(placed.layout, 'c');
		const parentCenter = parent.x + parent.width / 2;
		const childCenter = child.x + child.width / 2;
		expect(childCenter).toBe(parentCenter);
	});
});
