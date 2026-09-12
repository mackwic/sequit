import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { axesFor } from '../../directions';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'independent-nodes',
	label: 'Deux nœuds sans lien',
	group: 'Rangs et progression',
	order: 30,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			nodes: { a: { width: 100, height: 60 }, b: { width: 100, height: 60 } },
			relations: [],
		});
	},
	assert(layout) {
		const a = layout.getNodeById('a');
		const b = layout.getNodeById('b');
		AssertNode(a).hasRank(1);
		AssertNode(b).hasRank(1);
		const axes = axesFor(layout.direction);
		AssertBox(a).isAlignedWith(b, { by: axes.rowAlignment });
		AssertBox(layout.envelopeOf(['a', 'b'])).isCenteredIn(layout.frame, { axis: axes.transverse });
	},
};
