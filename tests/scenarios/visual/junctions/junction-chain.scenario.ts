import {
	defined,
	type LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { rowGap } from '../../../support/assertions/assert-rails';
import { minimumMetric } from '../../../support/assertions/routing-measurements';
import { junctionClearance, junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';
import type { LayoutScenario } from '../scenario';

const variants: readonly LayoutScenario[] = [
	{
		id: 'junction-chain',
		label: 'Deux jonctions directement chaînées',
		description:
			'Relations : B → J2 → J1 → A. La progression du layout est A, J1, J2, B. Les jonctions se succèdent sur des rails distincts suffisamment épais, entièrement dans le même intervalle. Aucun rang logique supplémentaire.',
		group: 'Jonctions et rails',
		order: 310,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.chain(direction, ['j1', 'j2']).build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);
			check.node('a').hasRank(1);
			check.node('b').hasRank(2);
			check
				.junctions(['j1', 'j2'])
				.areBetween(['a'], ['b'], junctionClearance)
				.areOnSeparateProgressiveRails(junctionClearance);
			check.junction('j1').isAlignedWith('a', { by: 'chain' }).isAlignedWith('j2', { by: 'chain' });
			check.node('b').isAlignedWith('j2', { by: 'chain' });
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-long-chain',
		label: 'Une chaîne récursive de quatre jonctions',
		description:
			'Relations : B → J4 → J3 → J2 → J1 → A. La recherche des boîtes encadrantes traverse récursivement les jonctions. Les quatre rails conservent leur ordre et leurs dégagements. L’intervalle est plus grand que pour une seule jonction.',
		group: 'Jonctions et rails',
		order: 320,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.chain(direction, ['j1', 'j2', 'j3', 'j4']).build(),
				direction,
				bias,
				reference: junctionFixtures.chain(direction).build(),
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);
			check.node('a').hasRank(1);
			check.node('b').hasRank(2);
			check
				.junctions(['j1', 'j2', 'j3', 'j4'])
				.areBetween(['a'], ['b'], junctionClearance)
				.areOnSeparateProgressiveRails(junctionClearance);
			for (const id of ['j1', 'j2', 'j3', 'j4'])
				check.junction(id).isAlignedWith('a', { by: 'chain' });
			minimumMetric(
				'Espace supplémentaire pour la chaîne',
				rowGap(layout, [['a'], ['b']]) - rowGap(defined(layout.reference).layout, [['a'], ['b']]),
				junctionClearance,
			);
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-unequal-chains',
		label: 'Deux branches avec des chaînes de longueurs différentes',
		description:
			'Relations : B → J1 → A, C → J2 → A et D → J3 → J2. Les branches occupent un ou deux rails successifs, mais B, C et D restent au rang 2 et dans la même rangée. Aucun centrage exact de la branche asymétrique n’est imposé.',
		group: 'Jonctions et rails',
		order: 370,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures
					.parallel(direction)
					.junctions(['j3'])
					.nodes(['d'])
					.successorsOf('j2', ['j3'])
					.successorsOf('j3', ['d'])
					.build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.node('a').hasRank(1);
			check.nodes(['b', 'c', 'd']).haveRank(2);
			check.junctions(['j1', 'j2', 'j3']).areBetween(['a'], ['b', 'c', 'd'], junctionClearance);
			check.junctions(['j2', 'j3']).areOnSeparateProgressiveRails(junctionClearance);
			check.node('b').isAlignedWith('c', { by: 'row' }).isAlignedWith('d', { by: 'row' });
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-shortcut',
		label: 'Une liaison saute une jonction intermédiaire',
		description:
			'B → J3 → J2 → J1 → A et J3 → J1. Le lien direct entre J3 et J1 contourne J2 avec un passage libre, sans retour en arrière. Il ne suffit pas de rechercher les sauts de rangs logiques : toutes les jonctions partagent le rang de A.',
		group: 'Jonctions et rails',
		order: 325,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.chain(direction, ['j1', 'j2', 'j3']).successorsOf('j1', ['j3']).build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);
			check.node('a').hasRank(1);
			check.node('b').hasRank(2);
			check
				.junctions(['j1', 'j2', 'j3'])
				.areBetween(['a'], ['b'], junctionClearance)
				.areOnSeparateProgressiveRails(junctionClearance);
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
];

export const scenario: LayoutScenario = {
	...defined(variants[0]),
	id: 'junction-chain',
	label: 'Chaînes de jonctions',
	variants,
};
