import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
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
			nodes: {
				a: { width: 100, height: 60 },
				b: { width: 100, height: 60 },
				c: { width: 100, height: 60 },
				d: { width: 100, height: 60 },
			},
			relations: [
				{ id: 'a-to-b', from: 'b', to: 'a' },
				{ id: 'a-to-c', from: 'c', to: 'a' },
				{ id: 'a-to-d', from: 'd', to: 'a' },
			],
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
