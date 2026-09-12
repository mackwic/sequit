import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'two-predecessors',
	label: 'Un enfant et deux parents',
	group: 'Convergences et croisements',
	order: 110,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...graphFixtures.twoPredecessors().build(), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.nodes(['a', 'b']).haveRank(1);
		check
			.node('c')
			.hasRank(2)
			.isCenteredOn(layout.envelopeOf(['a', 'b']), { axis: 'transverse' });
		for (const relation of layout.relations) check.node(relation.from).isAfter(relation.to);
		check.routes().haveNoCrossing();
	},
};
