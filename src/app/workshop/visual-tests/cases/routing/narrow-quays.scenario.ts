import { AssertRoute } from '../../assert-route';
import { axesFor } from '../../directions';
import { checkCompleteQuays, checkDistinctPaths, completePairs, routingScenario } from './fixtures';

export const scenario = routingScenario(
	{ id: 'narrow-quays', label: 'Deux quais agrandissent le nœud', order: 160 },
	{ ids: ['a', 'b', 'c', 'd'], links: completePairs },
	(layout) => {
		for (const [from, to] of [
			['a', 'c'],
			['b', 'd'],
		]) {
			const route = layout.relations.find(
				(relation) => relation.from === from && relation.to === to,
			);
			if (route === undefined) throw new Error(`Missing route: ${from} → ${to}`);
			AssertRoute(route).isStraightAlong(axesFor(layout.direction).primary);
		}
		checkCompleteQuays(layout);
		checkDistinctPaths(layout);
	},
);
