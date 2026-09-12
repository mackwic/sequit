import { AssertRails, rowGap } from '../../assert-rails';
import { AssertRoutes } from '../../assert-routes';
import { equalMetric } from '../../routing-measurements';
import { railPolicy, routingScenario } from './fixtures';

export const scenario = routingScenario(
	{ id: 'reused-rail', label: 'Deux fourches réutilisent le rail 0', order: 220 },
	{
		ids: ['a', 'b', 'c', 'd', 'e', 'f'],
		links: [
			['a', 'b'],
			['a', 'c'],
			['d', 'e'],
			['d', 'f'],
		],
	},
	(layout) => {
		const first = layout.relations.filter((route) => route.from === 'a');
		const second = layout.relations.filter((route) => route.from === 'd');
		AssertRoutes(first).haveNoOverlapWith(second);
		AssertRoutes(first).haveNoCrossingWith(second);
		AssertRails(layout, [['a'], ['b', 'c']]).haveCount(1);
		AssertRails(layout, [['d'], ['e', 'f']]).haveCount(1);
		AssertRails(layout, [
			['a', 'd'],
			['b', 'c', 'e', 'f'],
		])
			.haveCount(1)
			.haveRoom(railPolicy);
		equalMetric(
			'Intervalle partagé',
			rowGap(layout, [
				['a', 'd'],
				['b', 'c', 'e', 'f'],
			]),
			railPolicy.baseGap,
		);
	},
);
