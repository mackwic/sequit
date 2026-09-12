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
		id: 'junction-remove-cascade-origin',
		label: 'Suppression en cascade depuis l’origine',
		description:
			'Retirer B → J3 supprime J3, puis J2, puis J1 et toutes leurs relations. Les boîtes A et B sont conservées.',
		group: 'Jonctions et rails',
		order: 440,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.chain(direction, ['j1', 'j2', 'j3']).build(),
				direction,
				bias,
				edit: { removeRelations: ['j3-to-b'] },
				reference: true,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);
			check.document().hasEndpoints(['a', 'b']).hasRelations([]);
		},
	},
	{
		id: 'junction-remove-cascade-destination',
		label: 'Suppression en cascade depuis la destination',
		description:
			'Supprimer la boîte A retire l’ancre de destination. J1, puis J2, puis J3 disparaissent avec toutes leurs relations. B reste présent.',
		group: 'Jonctions et rails',
		order: 450,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures.chain(direction, ['j1', 'j2', 'j3']).build(),
				direction,
				bias,
				edit: { removeNodes: ['a'] },
				reference: true,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);
			check.document().hasEndpoints(['b']).hasRelations([]);
		},
	},
	{
		id: 'junction-cascade-stops',
		label: 'La collecte s’arrête devant une branche encore valide',
		description:
			'B → J2 → J1 → A et C → J1. Retirer B → J2 supprime J2, mais J1 conserve C comme origine et A comme destination. La collecte ne doit pas supprimer toute la chaîne aveuglément.',
		group: 'Jonctions et rails',
		order: 530,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures
					.chain(direction, ['j1', 'j2'])
					.nodes(['c'])
					.successorsOf('j1', ['c'])
					.build(),
				direction,
				bias,
				edit: { removeRelations: ['j2-to-b'] },
				reference: true,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.document().hasEndpoints(['a', 'b', 'c', 'j1']).hasRelations(['a-to-j1', 'j1-to-c']);
			check.junctions(['j1']).areBetween(['a'], ['c'], junctionClearance);
		},
	},
	{
		id: 'junction-release-space',
		label: 'Récupérer l’espace et les rails après suppression',
		description:
			'La référence contient B → J3 → J2 → J1 → A et C → A, avec des jonctions épaisses. Retirer B → J3 collecte la chaîne. La relation C → A conserve deux rangées permettant de mesurer la récupération de l’espace inter-rangées.',
		group: 'Jonctions et rails',
		order: 500,
		arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
			return layoutNodes({
				...junctionFixtures
					.chain(direction, ['j1', 'j2', 'j3'], 144)
					.nodes(['c'])
					.successorsOf('a', ['c'])
					.build(),
				direction,
				bias,
				edit: { removeRelations: ['j3-to-b'] },
				reference: true,
			});
		},
		assert(layout: VisualLayout): void {
			const check = AssertLayout(layout);

			check.document().hasEndpoints(['a', 'b', 'c']).hasRelations(['a-to-c']);
			check.node('a').hasRank(1);
			check.node('c').hasRank(2);
			equalMetric(
				'Retour à l’espacement de base',
				rowGap(layout, [['a'], ['c']]),
				railPolicy.baseGap,
			);
			minimumMetric(
				'Espace libéré après collecte',
				rowGap(defined(layout.reference).layout, [['a'], ['b', 'c']]) -
					rowGap(layout, [['a'], ['c']]),
				railPolicy.spacing,
			);
		},
	},
];

export const scenario: LayoutScenario = {
	...defined(variants[0]),
	id: 'junction-remove-cascade',
	label: 'Suppression en cascade et espace libéré',
	variants,
};
