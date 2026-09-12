import { expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { routeCrossings } from '../../../support/assertions/route-geometry';
import { junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';

it.each(Object.values(LayoutDirection))(
	'leaves air between bridges and endpoint symbols in %s',
	async (direction) => {
		const layout = await layoutNodes({
			...junctionFixtures.crossing(direction).build(),
			direction,
		});
		const crossings = routeCrossings(layout.relations);
		expect(crossings.length).toBeGreaterThan(0);
		for (const crossing of crossings) {
			for (const { bounds } of layout.elements) {
				const dx = Math.max(bounds.x - crossing.x, 0, crossing.x - bounds.x - bounds.width);
				const dy = Math.max(bounds.y - crossing.y, 0, crossing.y - bounds.y - bounds.height);
				// 6px bridge radius + 9px arrowhead + at least 9px of visible clearance.
				expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(24);
			}
		}
		AssertLayout(layout).renderedPaths().haveBridgeAtEveryCrossing();
	},
);
