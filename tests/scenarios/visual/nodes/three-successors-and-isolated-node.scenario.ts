import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertBox } from '../../../support/assertions/assert-box';
import { AssertNode } from '../../../support/assertions/assert-node';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
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
		const a = layout.getNodeById('a');
		const successors = ['b', 'c', 'd'];
		AssertNode(a).hasRank(1);
		for (const id of successors) {
			const successor = layout.getNodeById(id);
			AssertNode(successor).hasRank(2);
			AssertBox(successor).isAfter(a, { direction: layout.direction });
		}
		const envelope = layout.envelopeOf(successors);
		AssertBox(envelope).isCenteredIn(a, { axis: axesFor(layout.direction).transverse });
		const e = layout.getNodeById('e');
		AssertNode(e).hasRank(1);
		let separation = LayoutDirection.LeftToRight;
		if (axesFor(layout.direction).transverse === 'y') separation = LayoutDirection.TopToBottom;
		AssertBox(e).isAfter(envelope, { direction: separation });
	},
};
