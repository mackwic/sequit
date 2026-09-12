import {
	defined,
	type LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { junctionClearance, junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';
import type { LayoutScenario } from '../scenario';

const variants: readonly LayoutScenario[] = [
	{
		id: 'junction-nearest-row',
		label: 'Des voisins aux rangs 2, 3 et 4',
		description:
			'Relations : J → A, B → J, C → J, D → J, C → B et D → C. Parmi les voisins du côté des rangs croissants, B a le rang le plus faible : 2. J est placée juste avant sa rangée, entre A et B, même si C et D sont plus loin.',
		group: 'Jonctions et rails',
		order: 380,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.differentDepths(direction).build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.node('a').hasRank(1);
			check.node('b').hasRank(2);
			check.node('c').hasRank(3);
			check.node('d').hasRank(4);
			check.junctions(['j']).areBetween(['a'], ['b'], junctionClearance);
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-recursive-nearest-row',
		label: 'Chercher la rangée à travers une autre jonction',
		description:
			'Relations : B → J2 → J1 → A, C → B, D → C et D → J1. J1 voit directement D au rang 4 et, récursivement à travers J2, B au rang 2. Les deux jonctions doivent rester dans l’intervalle précédant B.',
		group: 'Jonctions et rails',
		order: 390,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.recursiveDepths(direction).build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.node('a').hasRank(1);
			check.node('b').hasRank(2);
			check.node('c').hasRank(3);
			check.node('d').hasRank(4);
			check
				.junctions(['j1', 'j2'])
				.areBetween(['a'], ['b'], junctionClearance)
				.areOnSeparateProgressiveRails(junctionClearance);
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-placement-bias',
		label: 'L’intervalle suit la rangée effective du voisin',
		description:
			'B → J → A, à côté de E → D → C → A. B conserve le rang logique 2 mais peut partager la rangée de C ou de E selon le biais. La jonction est juste avant la rangée effective de B, non systématiquement après le rang logique 1.',
		group: 'Jonctions et rails',
		order: 540,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures
					.chain(direction)
					.nodes(['c', 'd', 'e'])
					.successorsOf('a', ['c'])
					.successorsOf('c', ['d'])
					.successorsOf('d', ['e'])
					.build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.node('b').hasRank(2);
			check.node('e').hasRank(4);
			check.junctions(['j']).areImmediatelyBefore('b', ['a', 'c', 'd', 'e'], junctionClearance);
		},
	},
];

export const scenario: LayoutScenario = {
	...defined(variants[0]),
	id: 'junction-nearest-row',
	label: 'Choix de l’intervalle',
	variants,
};
