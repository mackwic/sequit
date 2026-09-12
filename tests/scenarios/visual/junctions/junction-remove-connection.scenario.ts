import {
	defined,
	type LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { VisualDocumentEdit } from '../../../support/harnesses/visual-document-edit';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';
import type { LayoutScenario } from '../scenario';

interface RemovalCase {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly junctions: readonly string[];
	readonly edit: VisualDocumentEdit;
	readonly endpoints: readonly string[];
}
const cases: readonly RemovalCase[] = [
	{
		id: 'junction-remove-last-origin',
		label: 'Supprimer la dernière origine',
		description:
			'La commande retire B → J, dernière entrée de J. J et sa sortie J → A disparaissent du document et du layout.',
		junctions: ['j'],
		edit: {
			removeRelations: ['j-to-b'],
		},
		endpoints: ['a', 'b'],
	},
	{
		id: 'junction-remove-last-destination',
		label: 'Supprimer la dernière destination',
		description:
			'La commande retire J → A, dernière sortie de J. J et son entrée B → J disparaissent du document et du layout.',
		junctions: ['j'],
		edit: {
			removeRelations: ['a-to-j'],
		},
		endpoints: ['a', 'b'],
	},
	{
		id: 'junction-remove-isolated',
		label: 'Collecter une jonction devenue isolée',
		description:
			'Supprimer simultanément A et B prive J de ses deux connexions. La jonction isolée disparaît du document et du dessin.',
		junctions: ['j'],
		edit: {
			removeNodes: ['a', 'b'],
		},
		endpoints: [],
	},
	{
		id: 'junction-remove-unanchored-chain',
		label: 'Collecter une chaîne privée de ses deux boîtes',
		description:
			'Supprimer A et B laisse temporairement une chaîne uniquement composée de jonctions. La commande doit la collecter entièrement, sans élément ni relation résiduelle.',
		junctions: ['j1', 'j2', 'j3'],
		edit: {
			removeNodes: ['a', 'b'],
		},
		endpoints: [],
	},
];
const variants = cases.map((entry): LayoutScenario => ({
	id: entry.id,
	label: entry.label,
	description: entry.description,
	group: 'Jonctions et rails',
	order: 420,
	arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
		return layoutNodes({
			...junctionFixtures.chain(direction, entry.junctions).build(),
			direction,
			bias,
			edit: entry.edit,
			reference: true,
		});
	},
	assert(layout: VisualLayout): void {
		AssertLayout(layout).document().hasEndpoints(entry.endpoints).hasRelations([]);
	},
}));
export const scenario: LayoutScenario = {
	...defined(variants[0]),
	id: 'junction-remove-connection',
	label: 'Perte d’une connexion indispensable',
	variants,
};
