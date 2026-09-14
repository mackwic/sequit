import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'long-relation',
	label: 'Relation longue hors des boîtes',
	group: 'Rails et quais',
	order: 167,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.routingNodes(['a', 'b', 'c'], direction)
				.arrowsFrom('b', ['a'])
				.arrowsFrom('c', ['b', 'a'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.node('a').hasRank(1);
		check.node('b').hasRank(2);
		check.node('c').hasRank(3);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
		check.obstacles().haveClearance(24);
		check.routes().haveNoCrossing();
		for (const id of ['b-to-a', 'c-to-b', 'c-to-a'])
			check.route(id).isStraightAlong(axesFor(layout.direction).primary);
	},
};
