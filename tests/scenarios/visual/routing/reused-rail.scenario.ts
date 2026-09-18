import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { rowGap } from '../../../support/assertions/assert-rails';
import { equalMetric } from '../../../support/assertions/routing-measurements';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { railPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'reused-rail',
	label: 'Deux fourches réutilisent le rail 0',
	group: 'Rails et ports',
	order: 220,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.routingNodes(['a', 'b', 'c', 'd', 'e', 'f'], direction)
				.arrowsFrom('a', ['b', 'c'])
				.arrowsFrom('d', ['e', 'f'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const first = layout.relations.filter((route) => route.from === 'a');
		const second = layout.relations.filter((route) => route.from === 'd');
		check.routes(first).haveNoOverlapWith(second);
		check.routes(first).haveNoCrossingWith(second);
		check.rails({ between: [['a'], ['b', 'c']] }).haveCount(1);
		check.rails({ between: [['d'], ['e', 'f']] }).haveCount(1);
		check
			.rails({
				between: [
					['a', 'd'],
					['b', 'c', 'e', 'f'],
				],
			})
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
