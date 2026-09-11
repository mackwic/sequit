import { LayoutDirection } from '../../../../lib/core/document/logic-document';
import { AssertBox } from '../assert-box';
import { AssertNode } from '../assert-node';
import { layoutNodes } from '../layout-nodes';
import type { LayoutScenario } from '../scenario';

export const directedChain: LayoutScenario = {
	id: 'directed-chain',
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			nodes: { a: { width: 100, height: 60 }, b: { width: 100, height: 60 } },
			relations: [{ id: 'a-to-b', from: 'a', to: 'b' }],
		});
	},
	assert(layout) {
		const a = layout.getNodeById('a');
		const b = layout.getNodeById('b');
		AssertNode(a).hasRank(1);
		AssertNode(b).hasRank(2);
		AssertBox(b).isAfter(a, { direction: layout.direction });
	},
};
