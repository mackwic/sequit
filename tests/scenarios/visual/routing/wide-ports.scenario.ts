import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { portPolicy, wideContent } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'wide-ports',
	label: 'Le contenu laisse assez de place aux ports',
	group: 'Rails et ports',
	order: 170,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures.crossingRoutes(direction, wideContent).build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes(['a-to-d', 'b-to-c']).haveCrossing();
		for (const id of ['a', 'b']) {
			check
				.ports(id, { role: 'outgoing' })
				.haveCountBetween(1, 2)
				.areCentered()
				.haveClearance(portPolicy);
			check.node(id).hasSizeForUsedPorts({ content: wideContent, ...portPolicy });
		}
		for (const id of ['c', 'd']) {
			check.ports(id, { role: 'incoming' }).haveCount(2).areCentered().haveClearance(portPolicy);
			check
				.node(id)
				.hasSizeForPorts({ content: wideContent, incoming: 2, outgoing: 0, ...portPolicy });
		}
		check.routes().areOrthogonal().followLayoutFlow().haveOnlyAllowedSharedTrunks();
		check.renderedPaths().haveBridgeAtEveryCrossing();
	},
};
