import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { layoutWideGroupObstacle } from '../../../support/harnesses/layout-wide-group-obstacle';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'wide-group-obstacle',
	label: 'Une relation évite le groupe voisin',
	group: 'Rails et quais',
	order: 170,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutWideGroupObstacle(direction, bias);
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.nodes(['u', 'v', 'w', 'x']).haveRank(3);
		check.nodes(['p', 'q', 's']).haveRank(2);
		check.node('r').hasRank(1);
		check.envelope(['g']).isAfter('s');
		check.envelope(['g']).isAfter('w', { direction: 'transverse-positive' });
		check.node('x').isAfter('g', { direction: 'transverse-positive' });
		check.obstacles().haveClearance(24);
		check.routes().areAttachedToEndpoints().areOrthogonal().followLayoutFlow();
	},
};
