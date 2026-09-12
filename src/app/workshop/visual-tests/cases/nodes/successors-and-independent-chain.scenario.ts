import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertBox } from '../../assert-box';
import { AssertNode } from '../../assert-node';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'successors-and-independent-chain',
	label: 'Une branche et une chaîne indépendantes',
	group: 'Successeurs et enveloppes',
	order: 80,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures.threeSuccessors().nodes(['e', 'f']).successorsOf('e', ['f']).build(),
		});
	},
	assert(layout) {
		const a = layout.getNodeById('a');
		const successors = ['b', 'c', 'd'];
		AssertNode(a).hasRank(1);
		for (const id of successors) {
			const successor = layout.getNodeById(id);
			AssertNode(successor).hasRank(2);
			AssertBox(successor).isAfter(a, { direction: layout.direction });
		}
		const envelope = layout.envelopeOf(successors);
		AssertBox(envelope).isCenteredIn(a, { axis: axesFor(layout.direction).transverse });
		const e = layout.getNodeById('e');
		AssertNode(e).hasRank(1);
		let separation = LayoutDirection.LeftToRight;
		if (axesFor(layout.direction).transverse === 'y') separation = LayoutDirection.TopToBottom;
		const f = layout.getNodeById('f');
		AssertNode(f).hasRank(2);
		AssertBox(f).isAfter(e, { direction: layout.direction });
		AssertBox(f).isCenteredIn(e, { axis: axesFor(layout.direction).transverse });
		AssertBox(layout.envelopeOf(['e', 'f'])).isAfter(layout.envelopeOf(['a', 'b', 'c', 'd']), {
			direction: separation,
		});
		const branch = layout.relations.filter(({ to }) => to === 'a');
		const chain = layout.relations.filter(({ to }) => to === 'e');
		AssertRoutes(branch).haveNoOverlapWith(chain);
		AssertRoutes(branch).haveNoCrossingWith(chain);
	},
};
