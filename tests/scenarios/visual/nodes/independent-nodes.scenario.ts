import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'independent-nodes',
	label: 'Deux nœuds sans lien',
	group: 'Rangs et progression',
	order: 30,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures.independentNodes(['a', 'b']).build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.nodes(['a', 'b']).haveRank(1);
		check.node('a').isAlignedWith('b', { by: 'row' });
		check.envelope(['a', 'b']).isCenteredOn(layout.frame, { axis: 'transverse' });
	},
};
