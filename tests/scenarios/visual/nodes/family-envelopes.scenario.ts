import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import {
	documentaryUseCases,
	USE_CASES_GROUPS,
} from '../../../support/fixtures/documentary-use-cases';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

/** Each family of children, with the parent its envelope is centered on. */
const FAMILIES: readonly (readonly [children: readonly string[], parent: string])[] = [
	[['regenerate'], 'documents-live'],
	[['familiar'], 'training'],
	[['freshness'], 'regenerate'],
	[['intuitive', 'onlyoffice'], 'familiar'],
	[['intuitive', 'onlyoffice'], 'xor'],
	[['orchestration', 'all-edits'], 'freshness'],
	[['interdependent', 'isolated', 'word-alcoa'], 'orchestration'],
	[['conclusion'], 'interdependent'],
	[['lossless'], 'isolated'],
	[['docx'], 'lossless'],
];

const STRAIGHT = [
	'regenerate-to-documents-live',
	'familiar-to-training',
	'freshness-to-regenerate',
	'xor-to-familiar',
	'conclusion-to-interdependent',
	'lossless-to-isolated',
	'docx-to-lossless',
];

export const scenario: LayoutScenario = {
	id: 'family-envelopes',
	label: 'Familles centrées sur leur parent, dans un groupe',
	group: 'Centrage et alignement',
	order: 25,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...documentaryUseCases(direction),
			direction,
			bias,
			groups: USE_CASES_GROUPS,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		for (const [children, parent] of FAMILIES)
			check.envelope(children).isCenteredOn(parent, { axis: 'transverse' });
		const primary = axesFor(layout.direction).primary;
		for (const id of STRAIGHT) check.route(id).isStraightAlong(primary);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
	},
};
