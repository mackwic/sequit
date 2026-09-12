import { AssertRails } from '../../assert-rails';
import { AssertRoutes } from '../../assert-routes';
import {
	checkCompleteQuays,
	checkDistinctPaths,
	completePairs,
	railPolicy,
	routingScenario,
} from './fixtures';

export const scenario = routingScenario(
	{ id: 'forced-crossing-rails', label: 'Croisement obligé : rails, quais et pont', order: 210 },
	{ ids: ['a', 'b', 'c', 'd'], links: completePairs },
	(layout) => {
		AssertRoutes(
			layout.relations.filter((route) => ['a-to-d', 'b-to-c'].includes(route.id)),
		).haveCrossing();
		checkDistinctPaths(layout);
		AssertRails(layout, [
			['a', 'b'],
			['c', 'd'],
		])
			.haveAtLeast(2)
			.haveRoom(railPolicy);
		checkCompleteQuays(layout);
	},
);
