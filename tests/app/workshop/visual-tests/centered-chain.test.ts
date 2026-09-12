import { describe, expect, it } from 'vitest';

import { scenario as centeredChain } from '../../../../src/app/workshop/visual-tests/cases/nodes/centered-chain.scenario';
import { VisualLayout } from '../../../../src/app/workshop/visual-tests/visual-layout';

describe('centered-chain shared scenario', () => {
	it('keeps the real failed geometry available to a caller', async () => {
		const layout = await centeredChain.arrange();
		const displaced = new VisualLayout({
			width: layout.width,
			height: layout.height,
			relations: layout.relations,
			elements: layout.elements.map((element) => {
				if (element.id !== 'b') return element;
				return { ...element, bounds: { ...element.bounds, x: element.bounds.x + 10 } };
			}),
		});
		expect(() => {
			centeredChain.assert(displaced);
		}).toThrow('difference=10');
		expect(displaced.elements).toHaveLength(2);
		centeredChain.assert(layout);
	});
	it.each(['a', 'b'])('does not silently pass when box %s is missing', async (id) => {
		const layout = await centeredChain.arrange();
		expect(() => {
			centeredChain.assert(
				new VisualLayout({
					width: layout.width,
					height: layout.height,
					relations: layout.relations,
					elements: layout.elements.filter((element) => element.id !== id),
				}),
			);
		}).toThrow(`Missing layout element: *[id="${id}"]`);
	});
});
