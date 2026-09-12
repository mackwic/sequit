import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertBox } from '../../../support/assertions/assert-box';
import { AssertNode } from '../../../support/assertions/assert-node';
import { AssertRenderedPaths } from '../../../support/assertions/assert-rendered-paths';
import { AssertRoutes } from '../../../support/assertions/assert-routes';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'shared-successors',
	label: 'Deux parents et deux successeurs communs',
	group: 'Successeurs et enveloppes',
	order: 90,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures.sharedSuccessors().build(),
		});
	},
	assert(layout) {
		for (const id of ['a', 'b']) AssertNode(layout.getNodeById(id)).hasRank(1);
		for (const id of ['c', 'd']) AssertNode(layout.getNodeById(id)).hasRank(2);
		AssertBox(layout.envelopeOf(['c', 'd'])).isCenteredIn(layout.envelopeOf(['a', 'b']), {
			axis: axesFor(layout.direction).transverse,
		});
		AssertRoutes(layout.relations).haveNoOverlap();
		AssertRoutes(
			layout.relations.filter(({ id }) => ['a-to-d', 'b-to-c'].includes(id)),
		).haveCrossing();
		AssertRenderedPaths(renderRelationPaths(layout.relations)).haveBridgeAtEveryCrossing();
	},
};
