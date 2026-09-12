import { defined, LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { rowGap } from '../../asserts/assert-rails';
import { AssertRoutes } from '../../asserts/assert-routes';
import { checkDistinctPaths, checkQuays, checkSize, railPolicy } from '../../asserts/routing';
import { equalMetric, extent, minimumMetric } from '../../asserts/routing-measurements';
import { axesFor } from '../../directions';
import { graphFixtures } from '../../fixtures/graph-fixtures';
import { layoutNodes } from '../../layout-nodes';
import type { LayoutScenario } from '../../scenario';

export const scenario: LayoutScenario = {
	id: 'released-rails-quays',
	label: 'Suppression : libérer les rails et les quais',
	group: 'Rails et quais',
	order: 230,
	async arrange(direction = LayoutDirection.TopToBottom, bias) {
		const before = await layoutNodes({
			direction,
			bias,
			...graphFixtures.crossingRoutes(direction).build(),
		});
		const after = await layoutNodes({
			direction,
			bias,
			...graphFixtures
				.routingNodes(['a', 'b', 'c', 'd'], direction)
				.arrowsFrom('a', ['c'])
				.arrowsFrom('b', ['d'])
				.build(),
		});
		return after.withReference('Avant : quatre relations et un croisement obligé', before);
	},
	assert(layout) {
		const before = defined(layout.reference).layout;
		checkDistinctPaths(layout);
		AssertRoutes(layout.relations).haveNoCrossing();
		for (const id of ['a', 'b']) checkQuays(layout, id, 'outgoing', 1);
		for (const id of ['c', 'd']) checkQuays(layout, id, 'incoming', 1);
		for (const id of ['a', 'b', 'c', 'd']) {
			checkSize(layout, id, [1, 1]);
			const axis = axesFor(layout.direction).transverse;
			minimumMetric(
				`Réduction du nœud ${id}`,
				extent(before.getById(id).bounds, axis) - extent(layout.getById(id).bounds, axis),
				16,
			);
		}
		equalMetric(
			'Retour à l’intervalle normal',
			rowGap(layout, [
				['a', 'b'],
				['c', 'd'],
			]),
			railPolicy.baseGap,
		);
		minimumMetric(
			'Libération des rails',
			rowGap(before, [
				['a', 'b'],
				['c', 'd'],
			]) -
				rowGap(layout, [
					['a', 'b'],
					['c', 'd'],
				]),
			railPolicy.spacing,
		);
	},
};
