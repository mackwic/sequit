import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
import { uniformNodeScenario } from '../../layout-nodes';

export const scenario = uniformNodeScenario({
	id: 'two-predecessors',
	label: 'Un enfant et deux parents',
	group: 'Convergences et croisements',
	order: 110,
	nodes: ['a', 'b', 'c'],
	size: { width: 100, height: 60 },
	relations: [
		{ id: 'a-to-c', from: 'c', to: 'a' },
		{ id: 'b-to-c', from: 'c', to: 'b' },
	],
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
});
