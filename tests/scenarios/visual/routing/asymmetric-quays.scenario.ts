import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { checkDistinctPaths, checkQuays, checkSize } from '../../../support/assertions/routing';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'asymmetric-quays',
	label: 'Deux quais entrants, trois sortants',
	group: 'Rails et quais',
	order: 180,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures
				.crossingRoutes(direction)
				.nodes(['e', 'f', 'g'])
				.arrowsFrom('c', ['e', 'f', 'g'])
				.arrowsFrom('d', ['e', 'f', 'g'])
				.build(),
		});
	},
	assert(layout) {
		for (const id of ['c', 'd']) {
			checkQuays(layout, id, 'incoming', 2);
			checkQuays(layout, id, 'outgoing', 3);
			checkSize(layout, id, [2, 3]);
		}
		checkDistinctPaths(layout);
	},
};
