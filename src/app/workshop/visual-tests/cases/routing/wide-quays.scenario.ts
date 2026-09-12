import {
	checkCompleteQuays,
	checkDistinctPaths,
	completePairs,
	routingScenario,
	wideContent,
} from './fixtures';

export const scenario = routingScenario(
	{ id: 'wide-quays', label: 'Le contenu laisse assez de place aux quais', order: 170 },
	{ ids: ['a', 'b', 'c', 'd'], links: completePairs, content: wideContent },
	(layout) => {
		checkCompleteQuays(layout, wideContent);
		checkDistinctPaths(layout);
	},
);
