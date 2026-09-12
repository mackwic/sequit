import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { quayPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'default-quays',
	label: 'Quai 0 entrant et sortant',
	group: 'Rails et quais',
	order: 150,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.routingNodes(['a', 'b', 'c'], direction)
				.arrowsFrom('a', ['b'])
				.arrowsFrom('b', ['c'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.quays('b', { side: 'incoming' }).haveCount(1).areCentered().haveClearance(quayPolicy);
		check.quays('b', { side: 'outgoing' }).haveCount(1).areCentered().haveClearance(quayPolicy);
		check
			.nodes(['a', 'b', 'c'])
			.haveSizeForQuays({ content: 80, incoming: 1, outgoing: 1, ...quayPolicy });
		check.routes().haveNoCrossing();
	},
};
