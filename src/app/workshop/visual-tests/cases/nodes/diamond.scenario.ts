import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
import { uniformNodeScenario } from '../../layout-nodes';

export const scenario = uniformNodeScenario({
	id: 'diamond',
	label: 'Un losange',
	group: 'Convergences et croisements',
	order: 130,
	nodes: ['a', 'b', 'c', 'd'],
	size: { width: 100, height: 60 },
	relations: [
		{ id: 'a-to-b', from: 'b', to: 'a' },
		{ id: 'a-to-c', from: 'c', to: 'a' },
		{ id: 'b-to-d', from: 'd', to: 'b' },
		{ id: 'c-to-d', from: 'd', to: 'c' },
	],
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
});
