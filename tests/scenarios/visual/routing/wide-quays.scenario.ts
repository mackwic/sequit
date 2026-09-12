import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { quayPolicy, wideContent } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'wide-quays',
	label: 'Le contenu laisse assez de place aux quais',
	group: 'Rails et quais',
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
				.quays(id, { side: 'outgoing' })
				.haveCountBetween(1, 2)
				.areCentered()
				.haveClearance(quayPolicy);
			check.node(id).hasSizeForUsedQuays({ content: wideContent, ...quayPolicy });
		}
		for (const id of ['c', 'd']) {
			check.quays(id, { side: 'incoming' }).haveCount(2).areCentered().haveClearance(quayPolicy);
			check
				.node(id)
				.hasSizeForQuays({ content: wideContent, incoming: 2, outgoing: 0, ...quayPolicy });
		}
		check.routes().areOrthogonal().followLayoutFlow().haveOnlyAllowedSharedTrunks();
		check.renderedPaths().haveBridgeAtEveryCrossing();
	},
};
