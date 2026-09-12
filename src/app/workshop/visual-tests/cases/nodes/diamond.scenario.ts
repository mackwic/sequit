import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../asserts/assert-box';
import { AssertNode } from '../../asserts/assert-node';
import { AssertRoutes } from '../../asserts/assert-routes';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'diamond',
	label: 'Un losange',
	group: 'Convergences et croisements',
	order: 130,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures
				.twoSuccessors()
				.nodes(['d'])
				.successorsOf('b', ['d'])
				.successorsOf('c', ['d'])
				.build(),
		});
	},
	assert(layout) {
		for (const id of ['a']) AssertNode(layout.getNodeById(id)).hasRank(1);
		for (const id of ['b', 'c']) AssertNode(layout.getNodeById(id)).hasRank(2);
		const axis = axesFor(layout.direction).transverse;
		AssertNode(layout.getNodeById('d')).hasRank(3);
		const middle = layout.envelopeOf(['b', 'c']);
		AssertBox(middle).isCenteredIn(layout.getById('a'), { axis });
		AssertBox(middle).isCenteredIn(layout.getById('d'), { axis });
		for (const relation of layout.relations) {
			AssertBox(layout.getById(relation.from)).isAfter(layout.getById(relation.to), {
				direction: layout.direction,
			});
		}
		AssertRoutes(layout.relations).haveNoCrossing();
	},
};
