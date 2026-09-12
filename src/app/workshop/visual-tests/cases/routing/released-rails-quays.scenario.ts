import { defined, LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { rowGap } from '../../assert-rails';
import { AssertRoutes } from '../../assert-routes';
import { axesFor } from '../../directions';
import { equalMetric, extent, minimumMetric } from '../../routing-measurements';
import type { LayoutScenario } from '../../scenario';
import {
	checkDistinctPaths,
	checkQuays,
	checkSize,
	completePairs,
	railPolicy,
	routingLayout,
} from './fixtures';

export const scenario: LayoutScenario = {
	id: 'released-rails-quays',
	label: 'Suppression : libérer les rails et les quais',
	group: 'Rails et quais',
	order: 230,
	async arrange(direction = LayoutDirection.TopToBottom, bias) {
		const ids = ['a', 'b', 'c', 'd'];
		const before = await routingLayout(ids, completePairs, 80, direction, bias);
		const after = await routingLayout(
			ids,
			[
				['a', 'c'],
				['b', 'd'],
			],
			80,
			direction,
			bias,
		);
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
