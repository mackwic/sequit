import { defined, LayoutDirection } from '../../../../../lib/core/document/logic-document';
import { AssertRails, rowGap } from '../../assert-rails';
import { equalMetric, minimumMetric } from '../../routing-measurements';
import type { LayoutScenario } from '../../scenario';
import {
	checkDistinctPaths,
	completePairs,
	type Link,
	railPolicy,
	routingLayout,
} from './fixtures';

const ids = ['x', 'y', 'a', 'b', 'c', 'd'];
const simpleLinks: readonly Link[] = [
	['x', 'y'],
	['y', 'a'],
	['y', 'b'],
	['a', 'c'],
	['b', 'd'],
];
export const scenario: LayoutScenario = {
	id: 'local-rails',
	label: 'Les rails agrandissent seulement leur intervalle',
	group: 'Rails et quais',
	order: 190,
	async arrange(direction = LayoutDirection.TopToBottom, bias) {
		const reference = await routingLayout(ids, simpleLinks, 80, direction, bias);
		const layout = await routingLayout(
			ids,
			[...simpleLinks.slice(0, 3), ...completePairs],
			80,
			direction,
			bias,
		);
		return layout.withReference('Référence : mêmes nœuds, sans les deux diagonales', reference);
	},
	assert(layout) {
		const reference = defined(layout.reference).layout;
		for (const rows of [
			[['x'], ['y']],
			[['y'], ['a', 'b']],
		] as const) {
			equalMetric('Intervalle non concerné', rowGap(layout, rows), rowGap(reference, rows));
		}
		minimumMetric(
			'Agrandissement local',
			rowGap(layout, [
				['a', 'b'],
				['c', 'd'],
			]) -
				rowGap(reference, [
					['a', 'b'],
					['c', 'd'],
				]),
			railPolicy.spacing,
		);
		AssertRails(layout, [
			['a', 'b'],
			['c', 'd'],
		])
			.haveAtLeast(2)
			.haveRoom(railPolicy);
		// Shared trunks remain permitted in the upstream fork.
		const crossing = layout.relations.filter((route) => ['a', 'b'].includes(route.from));
		checkDistinctPaths(layout, crossing);
	},
};
