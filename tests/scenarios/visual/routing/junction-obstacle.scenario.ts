import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { junctionObstacle } from '../../../support/fixtures/routing-obstacles';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'junction-obstacle',
	label: 'Une relation évite la jonction voisine',
	group: 'Rails et quais',
	order: 169,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...junctionObstacle(direction), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.node('r').hasRank(1);
		check.nodes(['p', 'q', 's']).haveRank(2);
		check.nodes(['u', 'v', 'w', 'g', 'x']).haveRank(3);
		check.junctions(['j']).areBetween(['s'], ['g'], 12);
		check.node('x').isAfter('g', { direction: 'transverse-positive' });
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
		check.obstacles().haveClearance(24);
		const axes = axesFor(layout.direction);
		for (const [from, to] of [
			['u', 'p'],
			['v', 'p'],
			['w', 'q'],
		] as const)
			check.route(`${from}-to-${to}`).staysWithin(layout.envelopeOf([from, to]), {
				axis: axes.transverse,
			});
		check.route('v-to-p').isStraightAlong(axes.primary);
	},
};
