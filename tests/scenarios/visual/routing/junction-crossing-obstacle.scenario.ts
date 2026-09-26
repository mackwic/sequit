import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { routeCrossings } from '../../../support/assertions/route-geometry';
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
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveCrossing();
		const incidentRoutes = new Map([
			['j1-to-s', 'j1'],
			['j2-to-j1', 'j2'],
			['g-to-j2', 'j2'],
		]);
		const crossingNearJunction = routeCrossings(layout.relations).some((crossing) => {
			const first = incidentRoutes.get(crossing.horizontalId);
			const second = incidentRoutes.get(crossing.verticalId);
			if ((first === undefined) === (second === undefined)) return false;
			const junction = layout.elements.find(({ id }) => id === (first ?? second));
			if (junction === undefined) throw new Error('Missing incident junction');
			const { x, y, width, height } = junction.bounds;
			const distance = Math.hypot(
				Math.max(x - crossing.x, 0, crossing.x - x - width),
				Math.max(y - crossing.y, 0, crossing.y - y - height),
			);
			return distance <= 48;
		});
		if (!crossingNearJunction)
			throw new Error('An incident j* route must cross an ordinary route near its junction');
		check.renderedPaths().haveBridgeAtEveryCrossing();
		check.obstacles().haveClearance(24);
	},
};
