import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'two-successors-with-descendant',
	label: 'Deux successeurs et un descendant',
	group: 'Successeurs et enveloppes',
	order: 100,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures.twoSuccessors().nodes(['d']).successorsOf('b', ['d']).build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const successors = ['b', 'c'];
		check.node('a').hasRank(1);
		for (const id of successors) check.node(id).hasRank(2).isAfter('a');
		check.envelope(successors).isCenteredOn('a', { axis: 'transverse' });
		check.node('d').hasRank(3).isAfter('b');
		check.envelope(['d']).isCenteredOn('b', { axis: 'transverse' });
	},
};
