import { expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { isVerticalDirection } from '../../../../src/lib/core/layout/geometry/layout-frame';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';

it.each(Object.values(LayoutDirection))(
	'aligns both departure ports with junction trunks in %s',
	async (direction) => {
		const input = { ...junctionFixtures.crossing(direction).build(), direction };
		const layout = await layoutNodes(input);
		let axis: 'x' | 'y' = 'x';
		if (!isVerticalDirection(direction)) axis = 'y';
		const box = layout.getById('d').bounds;
		let extent = box.width;
		if (!isVerticalDirection(direction)) extent = box.height;
		expect(extent).toBeGreaterThan(96);
		expect(extent).toBeLessThanOrEqual(120);
		const routes = layout.relations.filter(({ from }) => from === 'd');
		expect(routes).toHaveLength(2);
		for (const route of routes)
			expect(new Set(route.points.map((point) => point[axis])).size).toBe(1);
		AssertLayout(layout).routes().haveOnlyAllowedSharedTrunks();
		AssertLayout(layout).renderedPaths().haveBridgeAtEveryCrossing();
		const repeated = await layoutNodes({ ...input, relations: [...input.relations].reverse() });
		expect(repeated.elements).toEqual(layout.elements);
		expect(repeated.relations).toEqual(layout.relations);
	},
);

it('keeps the original width when junction alignment exceeds the enlargement budget', async () => {
	const direction = LayoutDirection.TopToBottom;
	const input = junctionFixtures.crossing(direction).build();
	const layout = await layoutNodes({
		...input,
		direction,
		junctions: { j1: { width: 200, height: 20 }, j2: { width: 200, height: 20 } },
	});
	expect(layout.getById('d').bounds.width).toBe(96);
	AssertLayout(layout).routes().haveOnlyAllowedSharedTrunks();
});
