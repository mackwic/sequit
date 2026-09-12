import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { quayPolicy } from '../../../support/fixtures/routing-fixtures';
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
		const check = AssertLayout(layout);
		for (const id of ['c', 'd']) {
			check.quays(id, { side: 'incoming' }).haveCount(2).areCentered().haveClearance(quayPolicy);
			check.quays(id, { side: 'outgoing' }).haveCount(3).areCentered().haveClearance(quayPolicy);
			check.node(id).hasSizeForQuays({ content: 80, incoming: 2, outgoing: 3, ...quayPolicy });
		}
		check.routes().areOrthogonal().areAttachedToEndpoints().haveNoOverlap();
		check.renderedPaths().haveBridgeAtEveryCrossing();
	},
};
