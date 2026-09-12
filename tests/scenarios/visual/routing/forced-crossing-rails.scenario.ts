import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { quayPolicy, railPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'forced-crossing-rails',
	label: 'Croisement obligé : rails, quais et pont',
	group: 'Rails et quais',
	order: 210,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...graphFixtures.crossingRoutes(direction).build(), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes(['a-to-d', 'b-to-c']).haveCrossing();
		check.routes().areOrthogonal().followLayoutFlow().haveOnlyAllowedSharedTrunks();
		check.renderedPaths().haveBridgeAtEveryCrossing();
		check
			.rails({
				between: [
					['a', 'b'],
					['c', 'd'],
				],
			})
			.haveAtLeast(2)
			.haveRoom(railPolicy);
		for (const id of ['a', 'b']) {
			check
				.quays(id, { side: 'outgoing' })
				.haveCountBetween(1, 2)
				.areCentered()
				.haveClearance(quayPolicy);
			check.node(id).hasSizeForUsedQuays({ content: 80, ...quayPolicy });
		}
		for (const id of ['c', 'd']) {
			check.quays(id, { side: 'incoming' }).haveCount(2).areCentered().haveClearance(quayPolicy);
			check.node(id).hasSizeForQuays({ content: 80, incoming: 2, outgoing: 0, ...quayPolicy });
		}
	},
};
