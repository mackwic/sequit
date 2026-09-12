import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'diamond',
	label: 'Un losange',
	group: 'Convergences et croisements',
	order: 130,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.twoSuccessors()
				.nodes(['d'])
				.successorsOf('b', ['d'])
				.successorsOf('c', ['d'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.node('a').hasRank(1);
		check.nodes(['b', 'c']).haveRank(2);
		check.node('d').hasRank(3);
		check
			.envelope(['b', 'c'])
			.isCenteredOn('a', { axis: 'transverse' })
			.isCenteredOn('d', { axis: 'transverse' });
		for (const relation of layout.relations) check.node(relation.from).isAfter(relation.to);
		check.routes().haveNoCrossing();
	},
};
