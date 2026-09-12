import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertBox } from '../../../support/assertions/assert-box';
import { AssertNode } from '../../../support/assertions/assert-node';
import { AssertRoutes } from '../../../support/assertions/assert-routes';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'avoidable-crossing',
	label: 'Un croisement évitable par permutation',
	group: 'Convergences et croisements',
	order: 140,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures
				.independentNodes(['a', 'b', 'c', 'd'])
				.successorsOf('a', ['d'])
				.successorsOf('b', ['c'])
				.build(),
		});
	},
	assert(layout) {
		for (const id of ['a', 'b']) AssertNode(layout.getNodeById(id)).hasRank(1);
		for (const id of ['c', 'd']) AssertNode(layout.getNodeById(id)).hasRank(2);
		const axis = axesFor(layout.direction).transverse;
		AssertBox(layout.getById('d')).isCenteredIn(layout.getById('a'), { axis });
		AssertBox(layout.getById('c')).isCenteredIn(layout.getById('b'), { axis });
		let transverseDirection = LayoutDirection.LeftToRight;
		if (axis === 'y') transverseDirection = LayoutDirection.TopToBottom;
		AssertBox(layout.getById('b')).isAfter(layout.getById('a'), { direction: transverseDirection });
		AssertBox(layout.getById('c')).isAfter(layout.getById('d'), { direction: transverseDirection });
		AssertRoutes(layout.relations).haveNoOverlap();
		for (const relation of layout.relations) {
			AssertBox(layout.getById(relation.from)).isAfter(layout.getById(relation.to), {
				direction: layout.direction,
			});
		}
		AssertRoutes(layout.relations).haveNoCrossing();
	},
};
