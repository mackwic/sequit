import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { rowGap } from '../../../support/assertions/assert-rails';
import {
	equalMetric,
	extent,
	minimumMetric,
} from '../../../support/assertions/routing-measurements';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { quayPolicy, railPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'released-rails-quays',
	label: 'Suppression : libérer les rails et les quais',
	group: 'Rails et quais',
	order: 230,
	async arrange(direction = LayoutDirection.TopToBottom, bias) {
		const before = await layoutNodes({
			...graphFixtures.crossingRoutes(direction).build(),
			direction,
			bias,
		});
		const after = await layoutNodes({
			...graphFixtures
				.routingNodes(['a', 'b', 'c', 'd'], direction)
				.arrowsFrom('a', ['c'])
				.arrowsFrom('b', ['d'])
				.build(),
			direction,
			bias,
		});
		return after.withReference('Avant : quatre relations et un croisement obligé', before);
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const before = defined(layout.reference).layout;
		check.routes().areOrthogonal().areAttachedToEndpoints().haveNoOverlap();
		check.renderedPaths().haveBridgeAtEveryCrossing();
		check.routes().haveNoCrossing();
		for (const id of ['a', 'b'])
			check.quays(id, { side: 'outgoing' }).haveCount(1).areCentered().haveClearance(quayPolicy);
		for (const id of ['c', 'd'])
			check.quays(id, { side: 'incoming' }).haveCount(1).areCentered().haveClearance(quayPolicy);
		for (const id of ['a', 'b', 'c', 'd']) {
			check.node(id).hasSizeForQuays({ content: 80, incoming: 1, outgoing: 1, ...quayPolicy });
		}
		for (const id of ['c', 'd']) {
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
