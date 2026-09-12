import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { quayPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'narrow-quays',
	label: 'Deux quais agrandissent le nœud',
	group: 'Rails et quais',
	order: 160,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...graphFixtures.crossingRoutes(direction).build(), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes(['a-to-d', 'b-to-c']).haveCrossing();
		for (const id of ['a-to-c', 'b-to-d']) {
			check.route(id).isStraightAlong(axesFor(layout.direction).primary);
		}

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
		check.routes().areOrthogonal().followLayoutFlow().haveOnlyAllowedSharedTrunks();
		check.renderedPaths().haveBridgeAtEveryCrossing();
	},
};
