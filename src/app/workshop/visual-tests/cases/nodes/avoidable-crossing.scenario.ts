import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
import { uniformNodeScenario } from '../../layout-nodes';

export const scenario = uniformNodeScenario({
	id: 'avoidable-crossing',
	label: 'Un croisement évitable par permutation',
	group: 'Convergences et croisements',
	order: 140,
	nodes: ['a', 'b', 'c', 'd'],
	size: { width: 100, height: 60 },
	relations: [
		{ id: 'a-to-d', from: 'd', to: 'a' },
		{ id: 'b-to-c', from: 'c', to: 'b' },
	],
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
});
