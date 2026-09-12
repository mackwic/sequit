import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'single-node',
	label: 'Un nœud',
	group: 'Centrage et alignement',
	order: 10,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures.independentNodes(['a']).build(),
		});
	},
	assert(layout) {
		const a = layout.getNodeById('a');
		AssertNode(a).hasRank(1);
		AssertBox(a).isCenteredIn(layout.frame, { axis: 'both' });
	},
};
