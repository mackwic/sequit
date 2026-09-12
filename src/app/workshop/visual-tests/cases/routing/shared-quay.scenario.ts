import { AssertRails, rowGap } from '../../assert-rails';
import { AssertRoutes } from '../../assert-routes';
import { AssertTrunks } from '../../assert-trunks';
import { axesFor } from '../../directions';
import { equalMetric } from '../../routing-measurements';
import { checkQuays, checkSize, railPolicy, routingScenario } from './fixtures';

export const scenario = routingScenario(
	{ id: 'shared-quay', label: 'Un quai partagé et des troncs communs', order: 200 },
	{
		ids: ['a', 'b', 'c', 'd', 'e'],
		links: [
			['a', 'b'],
			['a', 'c'],
			['a', 'd'],
			['a', 'e'],
		],
	},
	(layout) => {
		checkQuays(layout, 'a', 'outgoing', 1);
		checkSize(layout, 'a', [0, 1]);
		for (const id of ['b', 'c', 'd', 'e']) checkQuays(layout, id, 'incoming', 1);
		const axes = axesFor(layout.direction);
		AssertTrunks(layout.relations).haveSharedSegment(axes.primary, 1);
		const ordered = [...layout.relations].sort(
			(a, b) =>
				layout.getById(a.to).bounds[axes.transverse] - layout.getById(b.to).bounds[axes.transverse],
		);
		AssertTrunks(ordered.slice(0, 2)).haveSharedSegment(axes.transverse, 1);
		AssertTrunks(ordered.slice(2)).haveSharedSegment(axes.transverse, 1);
		AssertRoutes(layout.relations).haveNoCrossing();
		AssertRails(layout, [['a'], ['b', 'c', 'd', 'e']])
			.haveCount(1)
			.haveRoom(railPolicy);
		equalMetric(
			'Intervalle du rail 0',
			rowGap(layout, [['a'], ['b', 'c', 'd', 'e']]),
			railPolicy.baseGap,
		);
	},
);
