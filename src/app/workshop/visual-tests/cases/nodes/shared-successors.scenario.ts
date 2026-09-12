import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { renderRelationPaths } from '../../../../web/ui/canvas/render-relations';
import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { AssertRenderedPaths } from '../../assert-rendered-paths';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

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
