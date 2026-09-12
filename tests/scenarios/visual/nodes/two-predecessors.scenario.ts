import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertBox } from '../../../support/assertions/assert-box';
import { AssertNode } from '../../../support/assertions/assert-node';
import { AssertRoutes } from '../../../support/assertions/assert-routes';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'two-predecessors',
	label: 'Un enfant et deux parents',
	group: 'Convergences et croisements',
	order: 110,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ direction, bias, ...graphFixtures.twoPredecessors().build() });
	},
	assert(layout) {
		for (const id of ['a', 'b']) AssertNode(layout.getNodeById(id)).hasRank(1);
		for (const id of ['c']) AssertNode(layout.getNodeById(id)).hasRank(2);
		const axis = axesFor(layout.direction).transverse;
		AssertBox(layout.getById('c')).isCenteredIn(layout.envelopeOf(['a', 'b']), { axis });
		for (const relation of layout.relations) {
			AssertBox(layout.getById(relation.from)).isAfter(layout.getById(relation.to), {
				direction: layout.direction,
			});
		}
		AssertRoutes(layout.relations).haveNoCrossing();
	},
};
