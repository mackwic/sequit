import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'avoidable-crossing',
	label: 'Un croisement évitable par permutation',
	group: 'Convergences et croisements',
	order: 140,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.independentNodes(['a', 'b', 'c', 'd'])
				.successorsOf('a', ['d'])
				.successorsOf('b', ['c'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.nodes(['a', 'b']).haveRank(1);
		check.nodes(['c', 'd']).haveRank(2);
		check.node('d').isCenteredOn('a', { axis: 'transverse' });
		check.node('c').isCenteredOn('b', { axis: 'transverse' });
		check.node('b').isAfter('a', { direction: 'transverse-positive' });
		check.node('c').isAfter('d', { direction: 'transverse-positive' });
		check.routes().haveNoOverlap();
		for (const relation of layout.relations) check.node(relation.from).isAfter(relation.to);
		check.routes().haveNoCrossing();
	},
};
