import {
	defined,
	type LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { rowGap } from '../../../support/assertions/assert-rails';
import { equalMetric, minimumMetric } from '../../../support/assertions/routing-measurements';
import { junctionClearance, junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { railPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';
import type { LayoutScenario } from '../scenario';

const variants: readonly LayoutScenario[] = [
	{
		id: 'junction-parallel',
		label: 'Deux jonctions indépendantes sur le même rail',
		description:
			'Relations : B → J1 → A et C → J2 → A. J1 et J2 n’ont pas de connexion entre elles : elles partagent le rail de base. Chaque jonction est alignée avec sa branche, sans collision ni croisement évitable.',
		group: 'Jonctions et rails',
		order: 350,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({ ...junctionFixtures.parallel(direction).build(), direction, bias });
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.node('a').hasRank(1);
			check.nodes(['b', 'c']).haveRank(2);
			check
				.junctions(['j1', 'j2'])
				.areBetween(['a'], ['b', 'c'], junctionClearance)
				.areOnSameRail()
				.areOnBaseRail(['a'], ['b', 'c']);
			check.junction('j1').isAlignedWith('b', { by: 'chain' });
			check.junction('j2').isAlignedWith('c', { by: 'chain' });
			check.routes().haveNoCrossing();
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-mixed-route',
		label: 'Une jonction partage son rail avec une traverse',
		description:
			'Relations : B → J → A et C → A. B et C sont dans la même rangée. La traverse du lien direct C → A réutilise le rail de J sur une portion libre, sans traverser son rectangle ni son dégagement.',
		group: 'Jonctions et rails',
		order: 360,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({ ...junctionFixtures.mixed(direction).build(), direction, bias });
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.node('a').hasRank(1);
			check.nodes(['b', 'c']).haveRank(2);
			check.node('b').isAlignedWith('c', { by: 'row' });
			check
				.junctions(['j'])
				.areBetween(['a'], ['b', 'c'], junctionClearance)
				.areOnRailOfRoute('a-to-c');
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-thick-rail',
		label: 'Une grosse jonction épaissit le rail et écarte toute la rangée',
		description:
			'Mesure volontairement surdimensionnée pour éprouver le moteur : J mesure 144 sur l’axe principal, contre un ovale de 28 × 20 dans la référence. Relations : B → J → A et C → A. Son rail réserve son épaisseur et les dégagements : tout le rang de B et C recule ensemble. Cette variante ne représente pas la taille du symbole dans le produit.',
		group: 'Jonctions et rails',
		order: 400,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures
					.chain(direction, ['j'], 144)
					.nodes(['c'])
					.successorsOf('a', ['c'])
					.build(),
				direction,
				bias,
				reference: junctionFixtures.mixed(direction).build(),
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.node('a').hasRank(1);
			check.nodes(['b', 'c']).haveRank(2);
			check.node('b').isAlignedWith('c', { by: 'row' });
			check.junctions(['j']).areBetween(['a'], ['b', 'c'], junctionClearance);
			minimumMetric(
				'Un rail de jonction épais agrandit l’intervalle',
				rowGap(layout, [['a'], ['b', 'c']]) -
					rowGap(defined(layout.reference).layout, [['a'], ['b', 'c']]),
				railPolicy.spacing,
			);
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-shared-thickness',
		label: 'Deux tailles de jonctions sur un même rail',
		description:
			'B → J1 → A et C → J2 → A. La mesure de J1 est volontairement surdimensionnée à 144 sur l’axe principal pour éprouver le moteur ; J2 garde son ovale de 28 × 20. Leurs centres, et non leurs bords, partagent le rail. Ajouter J2 sur une portion libre ne cumule pas son épaisseur avec celle de J1 : l’intervalle reste celui de la référence contenant J1 et la branche directe C → A.',
		group: 'Jonctions et rails',
		order: 520,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures
					.chain(direction, ['j1'], 144)
					.nodes(['c'])
					.junctions(['j2'])
					.successorsOf('a', ['j2'])
					.successorsOf('j2', ['c'])
					.build(),
				direction,
				bias,
				reference: junctionFixtures
					.chain(direction, ['j1'], 144)
					.nodes(['c'])
					.successorsOf('a', ['c'])
					.build(),
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check
				.junctions(['j1', 'j2'])
				.areOnSameRail()
				.areBetween(['a'], ['b', 'c'], junctionClearance);
			check.node('b').isAlignedWith('c', { by: 'row' });
			equalMetric(
				'Épaisseur commune : maximum et non somme',
				rowGap(layout, [['a'], ['b', 'c']]),
				rowGap(defined(layout.reference).layout, [['a'], ['b', 'c']]),
			);
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
];

export const scenario: LayoutScenario = {
	...defined(variants[0]),
	id: 'junction-shared-rails',
	label: 'Partage et épaisseur des rails',
	variants,
};
