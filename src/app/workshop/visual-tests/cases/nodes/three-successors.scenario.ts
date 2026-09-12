import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../asserts/assert-box';
import { AssertNode } from '../../asserts/assert-node';
import { AssertRoutes } from '../../asserts/assert-routes';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'three-successors',
	label: 'Trois successeurs',
	group: 'Successeurs et enveloppes',
	order: 60,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures.threeSuccessors().build(),
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
		AssertRoutes(layout.relations).haveNoCrossing();
	},
};
