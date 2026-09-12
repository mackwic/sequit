import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'successors-and-independent-chain',
	label: 'Une branche et une chaîne indépendantes',
	group: 'Successeurs et enveloppes',
	order: 80,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures.threeSuccessors().nodes(['e', 'f']).successorsOf('e', ['f']).build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const successors = ['b', 'c', 'd'];
		check.node('a').hasRank(1);
		for (const id of successors) check.node(id).hasRank(2).isAfter('a');
		check.envelope(successors).isCenteredOn('a', { axis: 'transverse' });
		check.node('e').hasRank(1);
		check.node('f').hasRank(2).isAfter('e').isCenteredOn('e', { axis: 'transverse' });
		check
			.envelope(['e', 'f'])
			.isAfter(layout.envelopeOf(['a', 'b', 'c', 'd']), { direction: 'transverse-positive' });
		const branch = layout.relations.filter(({ to }) => to === 'a');
		const chain = layout.relations.filter(({ to }) => to === 'e');
		check.routes(branch).haveNoOverlapWith(chain).haveNoCrossingWith(chain);
	},
};
