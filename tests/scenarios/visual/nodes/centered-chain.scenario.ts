import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'centered-chain',
	label: 'Tailles différentes',
	group: 'Centrage et alignement',
	order: 20,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.independentNodes(['a'])
				.nodes(['b'], { width: 200, height: 120 })
				.successorsOf('a', ['b'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.node('a').isAlignedWith('b', { by: 'chain' });
	},
};
