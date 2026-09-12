import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { checkCompleteQuays, checkDistinctPaths } from '../../../support/assertions/routing';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { wideContent } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'wide-quays',
	label: 'Le contenu laisse assez de place aux quais',
	group: 'Rails et quais',
	order: 170,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures.crossingRoutes(direction, wideContent).build(),
		});
	},
	assert(layout) {
		checkCompleteQuays(layout, wideContent);
		checkDistinctPaths(layout);
	},
};
