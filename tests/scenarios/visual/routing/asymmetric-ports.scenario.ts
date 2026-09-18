import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { portPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'asymmetric-ports',
	label: 'Deux arrivées exclusives, trois départs partageables',
	group: 'Rails et ports',
	order: 180,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.crossingRoutes(direction)
				.nodes(['e', 'f', 'g'])
				.arrowsFrom('c', ['e', 'f', 'g'])
				.arrowsFrom('d', ['e', 'f', 'g'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes(['a-to-d', 'b-to-c']).haveCrossing();
		for (const id of ['c', 'd']) {
			check.ports(id, { role: 'incoming' }).haveCount(2).areCentered().haveClearance(portPolicy);
			check
				.ports(id, { role: 'outgoing' })
				.haveCountBetween(1, 3)
				.areCentered()
				.haveClearance(portPolicy);
			check.node(id).hasSizeForUsedPorts({ content: 80, ...portPolicy });
		}
		check.routes().areOrthogonal().followLayoutFlow().haveOnlyAllowedSharedTrunks();
		check.renderedPaths().haveBridgeAtEveryCrossing();
	},
};
