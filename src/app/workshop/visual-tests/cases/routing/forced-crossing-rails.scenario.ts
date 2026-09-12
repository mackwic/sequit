import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertRails } from '../../asserts/assert-rails';
import { AssertRoutes } from '../../asserts/assert-routes';
import { checkCompleteQuays, checkDistinctPaths, railPolicy } from '../../asserts/routing';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'forced-crossing-rails',
	label: 'Croisement obligé : rails, quais et pont',
	group: 'Rails et quais',
	order: 210,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ direction, bias, ...graphFixtures.crossingRoutes(direction).build() });
	},
	assert(layout) {
		AssertRoutes(
			layout.relations.filter((route) => ['a-to-d', 'b-to-c'].includes(route.id)),
		).haveCrossing();
		checkDistinctPaths(layout);
		AssertRails(layout, [
			['a', 'b'],
			['c', 'd'],
		])
			.haveAtLeast(2)
			.haveRoom(railPolicy);
		checkCompleteQuays(layout);
	},
};
