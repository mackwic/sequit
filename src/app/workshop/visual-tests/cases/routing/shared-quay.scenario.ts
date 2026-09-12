import { LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertRails, rowGap } from '../../asserts/assert-rails';
import { AssertRoutes } from '../../asserts/assert-routes';
import { AssertTrunks } from '../../asserts/assert-trunks';
import { checkQuays, checkSize, railPolicy } from '../../asserts/routing';
import { equalMetric } from '../../asserts/routing-measurements';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'shared-quay',
	label: 'Un quai partagé et des troncs communs',
	group: 'Rails et quais',
	order: 200,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			direction,
			bias,
			...graphFixtures
				.routingNodes(['a', 'b', 'c', 'd', 'e'], direction)
				.arrowsFrom('a', ['b', 'c', 'd', 'e'])
				.build(),
		});
	},
	assert(layout) {
		checkQuays(layout, 'a', 'outgoing', 1);
		checkSize(layout, 'a', [0, 1]);
		for (const id of ['b', 'c', 'd', 'e']) checkQuays(layout, id, 'incoming', 1);
		const axes = axesFor(layout.direction);
		AssertTrunks(layout.relations).haveSharedSegment(axes.primary, 1);
		const ordered = [...layout.relations].sort(
			(a, b) =>
				layout.getById(a.to).bounds[axes.transverse] - layout.getById(b.to).bounds[axes.transverse],
		);
		AssertTrunks(ordered.slice(0, 2)).haveSharedSegment(axes.transverse, 1);
		AssertTrunks(ordered.slice(2)).haveSharedSegment(axes.transverse, 1);
		AssertRoutes(layout.relations).haveNoCrossing();
		AssertRails(layout, [['a'], ['b', 'c', 'd', 'e']])
			.haveCount(1)
			.haveRoom(railPolicy);
		equalMetric(
			'Intervalle du rail 0',
			rowGap(layout, [['a'], ['b', 'c', 'd', 'e']]),
			railPolicy.baseGap,
		);
	},
};
