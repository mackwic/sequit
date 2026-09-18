import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { rowGap } from '../../../support/assertions/assert-rails';
import { equalMetric } from '../../../support/assertions/routing-measurements';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { portPolicy, railPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'shared-port',
	label: 'Un port partagé et des troncs communs',
	group: 'Rails et ports',
	order: 200,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.routingNodes(['a', 'b', 'c', 'd', 'e'], direction)
				.arrowsFrom('a', ['b', 'c', 'd', 'e'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.ports('a', { role: 'outgoing' }).haveCount(1).areCentered().haveClearance(portPolicy);
		check.node('a').hasSizeForPorts({ content: 80, incoming: 0, outgoing: 1, ...portPolicy });
		for (const id of ['b', 'c', 'd', 'e'])
			check.ports(id, { role: 'incoming' }).haveCount(1).areCentered().haveClearance(portPolicy);
		const axes = axesFor(layout.direction);
		check.trunks().haveSharedSegment(axes.primary, 1);
		const ordered = [...layout.relations].sort(
			(a, b) =>
				layout.getById(a.to).bounds[axes.transverse] - layout.getById(b.to).bounds[axes.transverse],
		);
		check.trunks(ordered.slice(0, 2)).haveSharedSegment(axes.transverse, 1);
		check.trunks(ordered.slice(2)).haveSharedSegment(axes.transverse, 1);
		check.routes().haveNoCrossing();
		check
			.rails({ between: [['a'], ['b', 'c', 'd', 'e']] })
			.haveCount(1)
			.haveRoom(railPolicy);
		equalMetric(
			'Intervalle du rail 0',
			rowGap(layout, [['a'], ['b', 'c', 'd', 'e']]),
			railPolicy.baseGap,
		);
	},
};
