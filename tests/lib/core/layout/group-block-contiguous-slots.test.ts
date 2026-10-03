import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { boundsFor, contains } from '../../../support/harnesses/layout';
import { measurement, placeWitness } from '../../../support/harnesses/layout-witness';

describe('group block row slots', () => {
	it('keeps the block at its first descendant slot and its children contiguous', () => {
		const placed = placeWitness({
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			nodes: [
				['a', { width: 80, height: 40 }, 'g'],
				['b', { width: 80, height: 40 }],
				['c', { width: 80, height: 40 }, 'g'],
				['sink', { width: 80, height: 40 }],
			],
			groups: [['g', measurement(100, 60, 20, 8)]],
			relations: [
				['a', 'sink'],
				['b', 'sink'],
				['c', 'sink'],
			],
		});
		const structure = prepareLayout(placed.graph, placed.ranks);
		const component = structure.components.find(({ ids }) => ids.includes('a'));
		if (component === undefined) throw new Error('Missing grouped component');
		const row = component.rows.ordinary.find((items) => items.includes('a'));
		expect(row).toEqual(['a', 'c', 'b']);
		expect(contains(boundsFor(placed.layout, 'g'), boundsFor(placed.layout, 'b'))).toBe(false);
	});
});
