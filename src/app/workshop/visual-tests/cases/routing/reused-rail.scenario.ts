import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertRails, rowGap } from '../../asserts/assert-rails';
import { AssertRoutes } from '../../asserts/assert-routes';
import { railPolicy } from '../../asserts/routing';
import { equalMetric } from '../../asserts/routing-measurements';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'reused-rail',
	label: 'Deux fourches réutilisent le rail 0',
	group: 'Rails et quais',
	order: 220,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures
				.routingNodes(['a', 'b', 'c', 'd', 'e', 'f'], direction)
				.arrowsFrom('a', ['b', 'c'])
				.arrowsFrom('d', ['e', 'f'])
				.build(),
		});
	},
	assert(layout) {
		const first = layout.relations.filter((route) => route.from === 'a');
		const second = layout.relations.filter((route) => route.from === 'd');
		AssertRoutes(first).haveNoOverlapWith(second);
		AssertRoutes(first).haveNoCrossingWith(second);
		AssertRails(layout, [['a'], ['b', 'c']]).haveCount(1);
		AssertRails(layout, [['d'], ['e', 'f']]).haveCount(1);
		AssertRails(layout, [
			['a', 'd'],
			['b', 'c', 'e', 'f'],
		])
			.haveCount(1)
			.haveRoom(railPolicy);
		equalMetric(
			'Intervalle partagé',
			rowGap(layout, [
				['a', 'd'],
				['b', 'c', 'e', 'f'],
			]),
			railPolicy.baseGap,
		);
	},
};
