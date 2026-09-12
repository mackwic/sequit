import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertRoutes } from '../../../support/assertions/assert-routes';
import { checkQuays, checkSize } from '../../../support/assertions/routing';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'default-quays',
	label: 'Quai 0 entrant et sortant',
	group: 'Rails et quais',
	order: 150,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures
				.routingNodes(['a', 'b', 'c'], direction)
				.arrowsFrom('a', ['b'])
				.arrowsFrom('b', ['c'])
				.build(),
		});
	},
	assert(layout) {
		checkQuays(layout, 'b', 'incoming', 1);
		checkQuays(layout, 'b', 'outgoing', 1);
		for (const id of ['a', 'b', 'c']) checkSize(layout, id, [1, 1]);
		AssertRoutes(layout.relations).haveNoCrossing();
	},
};
