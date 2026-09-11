import { LayoutDirection } from '../../../../lib/core/document/logic-document';
import { AssertBox } from '../assert-box';
import { AssertNode } from '../assert-node';
import { layoutNodes } from '../layout-nodes';
import type { LayoutScenario } from '../scenario';

export const singleNode: LayoutScenario = {
	id: 'single-node',
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			nodes: { a: { width: 100, height: 60 } },
			relations: [],
		});
	},
	assert(layout) {
		const a = layout.getNodeById('a');
		AssertNode(a).hasRank(1);
		AssertBox(a).isCenteredIn(layout.frame, { axis: 'both' });
	},
};
