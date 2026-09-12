import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../assert-box';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'centered-chain',
	label: 'Tailles différentes',
	group: 'Centrage et alignement',
	order: 20,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures
				.independentNodes(['a'])
				.nodes(['b'], { width: 200, height: 120 })
				.successorsOf('a', ['b'])
				.build(),
		});
	},
	assert(layout) {
		const a = layout.getById('a');
		const b = layout.getById('b');
		AssertBox(a).isAlignedWith(b, { by: axesFor(layout.direction).chainAlignment });
	},
};
