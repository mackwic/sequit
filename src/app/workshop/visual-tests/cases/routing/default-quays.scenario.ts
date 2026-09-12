import { AssertRoutes } from '../../assert-routes';
import { checkQuays, checkSize, routingScenario } from './fixtures';

export const scenario = routingScenario(
	{ id: 'default-quays', label: 'Quai 0 entrant et sortant', order: 150 },
	{
		ids: ['a', 'b', 'c'],
		links: [
			['a', 'b'],
			['b', 'c'],
		],
	},
	(layout) => {
		checkQuays(layout, 'b', 'incoming', 1);
		checkQuays(layout, 'b', 'outgoing', 1);
		for (const id of ['a', 'b', 'c']) checkSize(layout, id, [1, 1]);
		AssertRoutes(layout.relations).haveNoCrossing();
	},
);
