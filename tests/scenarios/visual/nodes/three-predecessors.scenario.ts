import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'three-predecessors',
	label: 'Un enfant et trois parents',
	group: 'Convergences et croisements',
	order: 120,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...graphFixtures.threePredecessors().build(), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.nodes(['a', 'b', 'c']).haveRank(1);
		check
			.node('d')
			.hasRank(2)
			.isCenteredOn(layout.envelopeOf(['a', 'b', 'c']), { axis: 'transverse' });
		for (const relation of layout.relations) check.node(relation.from).isAfter(relation.to);
		check.routes().haveNoCrossing();
	},
};
