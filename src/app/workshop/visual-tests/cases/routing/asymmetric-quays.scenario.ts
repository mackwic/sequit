import {
	checkDistinctPaths,
	checkQuays,
	checkSize,
	completePairs,
	routingScenario,
} from './fixtures';

export const scenario = routingScenario(
	{ id: 'asymmetric-quays', label: 'Deux quais entrants, trois sortants', order: 180 },
	{
		ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
		links: [
			...completePairs,
			['c', 'e'],
			['c', 'f'],
			['c', 'g'],
			['d', 'e'],
			['d', 'f'],
			['d', 'g'],
		],
	},
	(layout) => {
		for (const id of ['c', 'd']) {
			checkQuays(layout, id, 'incoming', 2);
			checkQuays(layout, id, 'outgoing', 3);
			checkSize(layout, id, [2, 3]);
		}
		checkDistinctPaths(layout);
	},
);
