import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { rowGap } from '../../../support/assertions/assert-rails';
import { equalMetric, minimumMetric } from '../../../support/assertions/routing-measurements';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { railPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'local-rails',
	label: 'Les rails agrandissent seulement leur intervalle',
	group: 'Rails et quais',
	order: 190,
	async arrange(direction = LayoutDirection.TopToBottom, bias) {
		const reference = await layoutNodes({
			direction,
			bias,
			...graphFixtures
				.routingNodes(['x', 'y', 'a', 'b', 'c', 'd'], direction)
				.arrowsFrom('x', ['y'])
				.arrowsFrom('y', ['a', 'b'])
				.arrowsFrom('a', ['c'])
				.arrowsFrom('b', ['d'])
				.build(),
		});
		const layout = await layoutNodes({
			direction,
			bias,
			...graphFixtures
				.routingNodes(['x', 'y', 'a', 'b', 'c', 'd'], direction)
				.arrowsFrom('x', ['y'])
				.arrowsFrom('y', ['a', 'b'])
				.arrowsFrom('a', ['c', 'd'])
				.arrowsFrom('b', ['c', 'd'])
				.build(),
		});
		return layout.withReference('Référence : mêmes nœuds, sans les deux diagonales', reference);
	},
	assert(layout) {
		const check = AssertLayout(layout);
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
		check
			.rails({
				between: [
					['a', 'b'],
					['c', 'd'],
				],
			})
			.haveAtLeast(2)
			.haveRoom(railPolicy);
		// Shared trunks remain permitted in the upstream fork.
		const crossing = layout.relations.filter((route) => ['a', 'b'].includes(route.from));
		check.routes(crossing).areOrthogonal().areAttachedToEndpoints().haveNoOverlap();
		check.renderedPaths(crossing).haveBridgeAtEveryCrossing();
	},
};
