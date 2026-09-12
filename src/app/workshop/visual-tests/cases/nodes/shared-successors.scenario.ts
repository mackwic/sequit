import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { renderRelationPaths } from '../../../../web/ui/canvas/render-relations';
import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { AssertRenderedPaths } from '../../assert-rendered-paths';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
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
			nodes: {
				a: { width: 100, height: 60 },
				b: { width: 100, height: 60 },
				c: { width: 100, height: 60 },
				d: { width: 100, height: 60 },
			},
			relations: [
				{ id: 'a-to-c', from: 'c', to: 'a' },
				{ id: 'a-to-d', from: 'd', to: 'a' },
				{ id: 'b-to-c', from: 'c', to: 'b' },
				{ id: 'b-to-d', from: 'd', to: 'b' },
			],
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
