import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { portPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'default-ports',
	label: 'Port 0 entrant et sortant',
	group: 'Rails et ports',
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
		check.ports('b', { role: 'incoming' }).haveCount(1).areCentered().haveClearance(portPolicy);
		check.ports('b', { role: 'outgoing' }).haveCount(1).areCentered().haveClearance(portPolicy);
		check
			.nodes(['a', 'b', 'c'])
			.haveSizeForPorts({ content: 80, incoming: 1, outgoing: 1, ...portPolicy });
		check.routes().haveNoCrossing();
	},
};
