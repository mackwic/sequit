import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { axesFor } from '../../directions';
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
			nodes: {
				a: { width: 100, height: 60 },
				b: { width: 100, height: 60 },
				c: { width: 100, height: 60 },
				d: { width: 100, height: 60 },
			},
			relations: [
				{ id: 'a-to-b', from: 'b', to: 'a' },
				{ id: 'a-to-c', from: 'c', to: 'a' },
				{ id: 'b-to-d', from: 'd', to: 'b' },
			],
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
