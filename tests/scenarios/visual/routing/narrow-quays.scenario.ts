import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertRoute } from '../../../support/assertions/assert-route';
import { checkCompleteQuays, checkDistinctPaths } from '../../../support/assertions/routing';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'narrow-quays',
	label: 'Deux quais agrandissent le nœud',
	group: 'Rails et quais',
	order: 160,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ direction, bias, ...graphFixtures.crossingRoutes(direction).build() });
	},
	assert(layout) {
		for (const [from, to] of [
			['a', 'c'],
			['b', 'd'],
		]) {
			const route = layout.relations.find(
				(relation) => relation.from === from && relation.to === to,
			);
			if (route === undefined) throw new Error(`Missing route: ${from} → ${to}`);
			AssertRoute(route).isStraightAlong(axesFor(layout.direction).primary);
		}
		checkCompleteQuays(layout);
		checkDistinctPaths(layout);
	},
};
