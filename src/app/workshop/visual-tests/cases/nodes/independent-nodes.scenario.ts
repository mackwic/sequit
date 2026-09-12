import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../asserts/assert-box';
import { AssertNode } from '../../asserts/assert-node';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
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
			...graphFixtures.independentNodes(['a', 'b']).build(),
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
