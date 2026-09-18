import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { junctionCrossingObstacle } from '../../../support/fixtures/junction-crossing-obstacle';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'junction-crossing-obstacle',
	label: 'Un croisement respecte les rails de jonction',
	group: 'Rails et ports',
	order: 171,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...junctionCrossingObstacle(), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.junctions(['j1', 'j2']).areBetween(['s'], ['g'], 12).areOnSeparateProgressiveRails(12);
		check.node('r').hasRank(1);
		check.nodes(['p0', 's', 'p1', 'p2']).haveRank(2);
		check.nodes(['u0', 'g', 'u1', 'u2']).haveRank(3);
		check.node('g').isAfter('u0', { direction: 'transverse-positive' });
		check.node('u1').isAfter('g', { direction: 'transverse-positive' });
		check.node('u2').isAfter('u1', { direction: 'transverse-positive' });
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveCrossing();
		check.obstacles().haveClearance(24);
	},
};
