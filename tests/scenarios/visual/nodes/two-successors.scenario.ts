import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'two-successors',
	label: 'Deux successeurs',
	group: 'Successeurs et enveloppes',
	order: 50,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures.twoSuccessors().build(),
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const successors = ['b', 'c'];
		check.node('a').hasRank(1);
		check.nodes(successors).haveRank(2).areAfter('a');
		check.envelope(successors).isCenteredOn('a', { axis: 'transverse' });
		check.routes().haveNoCrossing();
	},
};
