import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'three-successors',
	label: 'Trois successeurs',
	group: 'Successeurs et enveloppes',
	order: 60,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures.threeSuccessors().build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const successors = ['b', 'c', 'd'];
		check.node('a').hasRank(1);
		for (const id of successors) check.node(id).hasRank(2).isAfter('a');
		check.envelope(successors).isCenteredOn('a', { axis: 'transverse' });
		check.routes().haveNoCrossing();
	},
};
