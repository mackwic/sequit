import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../asserts/assert-box';
import { AssertNode } from '../../asserts/assert-node';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'two-successors-with-descendant',
	label: 'Deux successeurs et un descendant',
	group: 'Successeurs et enveloppes',
	order: 100,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures.twoSuccessors().nodes(['d']).successorsOf('b', ['d']).build(),
		});
	},
	assert(layout) {
		const a = layout.getNodeById('a');
		const successors = ['b', 'c'];
		AssertNode(a).hasRank(1);
		for (const id of successors) {
			const successor = layout.getNodeById(id);
			AssertNode(successor).hasRank(2);
			AssertBox(successor).isAfter(a, { direction: layout.direction });
		}
		const envelope = layout.envelopeOf(successors);
		const axis = axesFor(layout.direction).transverse;
		AssertBox(envelope).isCenteredIn(a, { axis });
		const b = layout.getNodeById('b');
		const d = layout.getNodeById('d');
		AssertNode(d).hasRank(3);
		AssertBox(d).isAfter(b, { direction: layout.direction });
		AssertBox(layout.envelopeOf(['d'])).isCenteredIn(b, { axis });
	},
};
