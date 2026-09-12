import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertBox } from '../../../support/assertions/assert-box';
import { AssertNode } from '../../../support/assertions/assert-node';
import { AssertRoute } from '../../../support/assertions/assert-route';
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
			direction,
			bias,
			...graphFixtures.directedChain().build(),
		});
	},
	assert(layout) {
		const a = layout.getNodeById('a');
		const b = layout.getNodeById('b');
		AssertNode(a).hasRank(1);
		AssertNode(b).hasRank(2);
		AssertBox(b).isAfter(a, { direction: layout.direction });
		AssertRoute(defined(layout.relations.find(({ id }) => id === 'a-to-b')))
			.isOrthogonal()
			.isAttachedTo(b, a);
	},
};
