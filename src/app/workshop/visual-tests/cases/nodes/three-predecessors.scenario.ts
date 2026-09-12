import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
import { uniformNodeScenario } from '../../layout-nodes';

export const scenario = uniformNodeScenario({
	id: 'three-predecessors',
	label: 'Un enfant et trois parents',
	group: 'Convergences et croisements',
	order: 120,
	nodes: ['a', 'b', 'c', 'd'],
	size: { width: 100, height: 60 },
	relations: [
		{ id: 'a-to-d', from: 'd', to: 'a' },
		{ id: 'b-to-d', from: 'd', to: 'b' },
		{ id: 'c-to-d', from: 'd', to: 'c' },
	],
	assert(layout) {
		for (const id of ['a', 'b', 'c']) AssertNode(layout.getNodeById(id)).hasRank(1);
		for (const id of ['d']) AssertNode(layout.getNodeById(id)).hasRank(2);
		const axis = axesFor(layout.direction).transverse;
		AssertBox(layout.getById('d')).isCenteredIn(layout.envelopeOf(['a', 'b', 'c']), { axis });
		for (const relation of layout.relations) {
			AssertBox(layout.getById(relation.from)).isAfter(layout.getById(relation.to), {
				direction: layout.direction,
			});
		}
		AssertRoutes(layout.relations).haveNoCrossing();
	},
});
