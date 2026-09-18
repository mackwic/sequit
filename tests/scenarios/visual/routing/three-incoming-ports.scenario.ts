import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { portPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'three-incoming-ports',
	label: 'Trois arrivées saturent une face étroite',
	group: 'Rails et ports',
	order: 161,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.routingNodes(['a', 'b', 'c', 'd', 'e'], direction)
				.arrowsFrom('a', ['d', 'e'])
				.arrowsFrom('b', ['d', 'e'])
				.arrowsFrom('c', ['d', 'e'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes().haveCrossing();
		for (const id of ['d', 'e']) {
			check.ports(id, { role: 'incoming' }).haveCount(3).areCentered().haveClearance(portPolicy);
			check.node(id).hasSizeForPorts({
				content: 80,
				incoming: 3,
				outgoing: 0,
				...portPolicy,
			});
		}
		for (const id of ['a', 'b', 'c']) {
			check
				.ports(id, { role: 'outgoing' })
				.haveCountBetween(1, 2)
				.areCentered()
				.haveClearance(portPolicy);
			check.node(id).hasSizeForUsedPorts({ content: 80, ...portPolicy });
		}
		check
			.routes()
			.areOrthogonal()
			.areAttachedToEndpoints()
			.followLayoutFlow()
			.haveOnlyAllowedSharedTrunks();
		check.renderedPaths().haveBridgeAtEveryCrossing();
	},
};
