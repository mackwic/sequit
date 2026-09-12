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
		id: 'junction-fan-in',
		label: 'Plusieurs entrées sur une jonction',
		description:
			'Relations : B → J, C → J, J → A. Dans ce motif symétrique, J est centrée sur les enveloppes de ses voisins des deux côtés. Les quais respectent le sens des flèches ; partager un tronc suit les règles générales, sans exception liée à l’opérateur.',
		group: 'Jonctions et rails',
		order: 330,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.incomingBranches(direction).build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);
			check.node('a').hasRank(1);
			check.nodes(['b', 'c']).haveRank(2);
			check.junctions(['j']).areBetween(['a'], ['b', 'c'], junctionClearance);
			check.envelope(['a']).isCenteredOn('j', { axis: 'transverse' });
			check.envelope(['b', 'c']).isCenteredOn('j', { axis: 'transverse' });
			check.routes().haveNoCrossing();
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-fan-out',
		label: 'Plusieurs sorties sur une jonction',
		description:
			'Relations : B → J, J → A, J → C. Dans ce motif symétrique, J est centrée sur les enveloppes de ses voisins des deux côtés. Les quais respectent le sens des flèches ; partager un tronc suit les règles générales, sans exception liée à l’opérateur.',
		group: 'Jonctions et rails',
		order: 340,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.outgoingBranches(direction).build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);
			check.nodes(['a', 'c']).haveRank(1);
			check.node('b').hasRank(2);
			check.junctions(['j']).areBetween(['a', 'c'], ['b'], junctionClearance);
			check.envelope(['a', 'c']).isCenteredOn('j', { axis: 'transverse' });
			check.envelope(['b']).isCenteredOn('j', { axis: 'transverse' });
			check.routes().haveNoCrossing();
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-converge-diverge',
		label: 'Une convergence puis une divergence',
		description:
			'Relations : J → A, J → C, B → J, K → B, D → K, E → K. Ce motif reprend convergence et divergence avec une boîte intermédiaire. Chaque jonction appartient à son propre intervalle. Les trois rangées de boîtes restent distinctes ; les motifs symétriques sont centrés.',
		group: 'Jonctions et rails',
		order: 510,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures
					.outgoingBranches(direction)
					.nodes(['d', 'e'])
					.junctions(['k'])
					.successorsOf('b', ['k'])
					.successorsOf('k', ['d', 'e'])
					.build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.nodes(['a', 'c']).haveRank(1);
			check.node('b').hasRank(2);
			check.nodes(['d', 'e']).haveRank(3);
			check.junctions(['j']).areBetween(['a', 'c'], ['b'], junctionClearance);
			check.junctions(['k']).areBetween(['b'], ['d', 'e'], junctionClearance);
			check.envelope(['a', 'c']).isCenteredOn('j', { axis: 'transverse' });
			check.envelope(['d', 'e']).isCenteredOn('k', { axis: 'transverse' });
			check.junction('j').isAlignedWith('b', { by: 'chain' });
			check.junction('k').isAlignedWith('b', { by: 'chain' });
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
	{
		id: 'junction-diamond',
		label: 'Deux branches de jonctions se rejoignent',
		description:
			'B → J4, J4 → J2/J3, J2/J3 → J1 et J1 → A. Les deux branches partagent un rail entre J1 et J4. Leur réunion ne crée aucun rang de nœud supplémentaire et conserve les dégagements.',
		group: 'Jonctions et rails',
		order: 515,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures
					.chain(direction, ['j1', 'j2', 'j4'])
					.junctions(['j3'])
					.successorsOf('j1', ['j3'])
					.successorsOf('j3', ['j4'])
					.build(),
				direction,
				bias,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);
			check.node('a').hasRank(1);
			check.node('b').hasRank(2);
			check.junctions(['j1', 'j2', 'j3', 'j4']).areBetween(['a'], ['b'], junctionClearance);
			check.junctions(['j1', 'j2', 'j4']).areOnSeparateProgressiveRails(junctionClearance);
			check.junctions(['j2', 'j3']).areOnSameRail();
			check.routes().haveNoCrossing();
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
			check.obstacles().haveClearance(junctionClearance);
		},
	},
];

export const scenario: LayoutScenario = {
	...defined(variants[0]),
	id: 'junction-branches',
	label: 'Branchements autour des jonctions',
	variants,
};
