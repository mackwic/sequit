import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'three-successors-and-isolated-node',
	label: 'Trois successeurs et un nœud isolé',
	group: 'Successeurs et enveloppes',
	order: 70,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures.threeSuccessors().withIsolatedNode('e').build(),
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const successors = ['b', 'c', 'd'];
		const branchEnvelope = layout.envelopeOf(successors);
		check.node('a').hasRank(1);
		check.nodes(successors).haveRank(2).areAfter('a');
		check.envelope(successors).isCenteredOn('a', { axis: 'transverse' });
		check.node('e').hasRank(1).isAfter(branchEnvelope, { direction: 'transverse-positive' });
	},
};
