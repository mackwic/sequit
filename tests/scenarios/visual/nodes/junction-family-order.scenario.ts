import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import {
	REWORKED_USE_CASES_GROUPS,
	reworkedUseCases,
} from '../../../support/fixtures/documentary-use-cases';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

/** Each family of children, with the parent its envelope is centered on. */
const FAMILIES: readonly (readonly [children: readonly string[], parent: string])[] = [
	[['all-edits', 'intuitive', 'onlyoffice'], 'familiar'],
	[['all-edits', 'intuitive', 'onlyoffice'], 'xor'],
	[['xor'], 'familiar'],
	[['docx'], 'lossless'],
	[['lossless'], 'isolated'],
	[['orchestration', 'conclusion'], 'interdependent'],
	[['familiar'], 'training'],
	[['freshness'], 'regenerate'],
	[['regenerate'], 'documents-live'],
	[['word-alcoa'], 'traceable'],
];

export const scenario: LayoutScenario = {
	id: 'junction-family-order',
	label: 'Une famille derrière une jonction rejoint son parent',
	group: 'Centrage et alignement',
	order: 26,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...reworkedUseCases(direction),
			direction,
			bias,
			groups: REWORKED_USE_CASES_GROUPS,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		for (const [children, parent] of FAMILIES)
			check.envelope(children).isCenteredOn(parent, { axis: 'transverse' });
		check.node('familiar').isAfter('lossless', { direction: 'transverse-positive' });
		check.node('all-edits').isAfter('docx', { direction: 'transverse-positive' });
		check.route('xor-to-familiar').isStraightAlong(axesFor(layout.direction).primary);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
	},
};
