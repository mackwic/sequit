import {
	defined,
	type LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';
import type { LayoutScenario } from '../scenario';

const cases = [
	{
		id: 'junction-preserve-origin-branch',
		label: 'Perdre une entrée en conservant une origine',
		description:
			'Retirer C → J conserve B → J → A. J reste valide ; C devient une boîte indépendante.',
		fixture: 'incomingBranches',
		relation: 'j-to-c',
	},
	{
		id: 'junction-preserve-destination-branch',
		label: 'Perdre une sortie en conservant une destination',
		description:
			'Retirer J → C conserve B → J → A. J reste valide ; C devient une boîte indépendante.',
		fixture: 'outgoingBranches',
		relation: 'c-to-j',
	},
] as const;
const variants = cases.map((entry): LayoutScenario => ({
	id: entry.id,
	label: entry.label,
	description: entry.description,
	group: 'Jonctions et rails',
	order: 460,
	arrange(direction = LayoutDirection.TopToBottom, bias?: LayoutBias): Promise<VisualLayout> {
		return layoutNodes({
			...junctionFixtures[entry.fixture](direction).build(),
			direction,
			bias,
			edit: { removeRelations: [entry.relation] },
			reference: true,
		});
	},
	assert(layout: VisualLayout): void {
		AssertLayout(layout)
			.document()
			.hasEndpoints(['a', 'b', 'c', 'j'])
			.hasRelations(['a-to-j', 'j-to-b']);
	},
}));
export const scenario: LayoutScenario = {
	...defined(variants[0]),
	id: 'junction-preserve-branch',
	label: 'Conserver une branche valide',
	variants,
};
