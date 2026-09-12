import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'directed-chain',
	label: 'B → A · A racine',
	group: 'Rangs et progression',
	order: 40,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures.directedChain().build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.node('a').hasRank(1);
		check.node('b').hasRank(2).isAfter('a');
		check.route('a-to-b').isOrthogonal().isAttachedTo(layout.getById('b'), layout.getById('a'));
	},
};
