import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import {
	DOCUMENTARY_MAP_GROUPS,
	documentaryMap,
	REWORKED_USE_CASES_FAMILIES,
} from '../../../support/fixtures/documentary-use-cases';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';
import type { LayoutScenario } from '../scenario';

/** A foreign box keeps the rail clearance along the flow and the item gap beside the frame. */
const FRAME_CLEARANCE = { along: 48, across: 36 };

/** Families of the goal's tree at the root, with the parent they hang from. */
const ROOT_FAMILIES: readonly (readonly [children: readonly string[], parent: string])[] = [
	[['guarantees', 'minimal', 'ai-tooling'], 'goal'],
	[['alcoa-plus', 'partner-content'], 'guarantees'],
	[['docx-word'], 'minimal'],
	[['data-team', 'prompt'], 'ai-tooling'],
];

/** Traceability's neighbors in the group's first row. */
const FIRST_ROW = ['interdependent', 'isolated', 'documents-live', 'training'];

const TRANSVERSE = { direction: 'transverse-positive' } as const;

/** The group keeps foreign boxes out and every family stays centered on its parent. */
function keepsFamiliesTidy(layout: VisualLayout): void {
	const check = AssertLayout(layout);
	check.group('use-cases').isClearOfForeignBoxes(FRAME_CLEARANCE);
	for (const [children, parent] of [...ROOT_FAMILIES, ...REWORKED_USE_CASES_FAMILIES])
		check.envelope(children).isCenteredOn(parent, { axis: 'transverse' });
}

/**
 * The goal's relation enters the frame on the goal's side: whichever side the goal takes,
 * Traceable stands beyond every first-row peer in the goal's direction.
 */
function facesGoal(layout: VisualLayout): void {
	const check = AssertLayout(layout);
	const { transverse } = axesFor(layout.direction);
	const goal = layout.getById('goal').bounds[transverse];
	if (goal > layout.getById('use-cases').bounds[transverse]) {
		check.node('goal').isAfter('use-cases', TRANSVERSE);
		for (const id of FIRST_ROW) check.node('traceable').isAfter(id, TRANSVERSE);
		return;
	}
	check.group('use-cases').isAfter('goal', TRANSVERSE);
	for (const id of FIRST_ROW) check.node(id).isAfter('traceable', TRANSVERSE);
}

const separate: LayoutScenario = {
	id: 'goal-into-group-separate',
	label: 'Carte documentaire : le but et le groupe séparés',
	group: 'Groupes et familles',
	order: 670,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...documentaryMap(direction, { goalToTraceable: false }),
			direction,
			bias,
			groups: DOCUMENTARY_MAP_GROUPS,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
		keepsFamiliesTidy(layout);
	},
};

const linked: LayoutScenario = {
	id: 'goal-into-group-linked',
	label: 'Carte documentaire : le but relié à la traçabilité du groupe',
	group: 'Groupes et familles',
	order: 675,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...documentaryMap(direction, { goalToTraceable: true }),
			direction,
			bias,
			groups: DOCUMENTARY_MAP_GROUPS,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
		keepsFamiliesTidy(layout);
		facesGoal(layout);
	},
};

export const scenario: LayoutScenario = {
	...linked,
	id: 'goal-into-group',
	label: 'Un but relié à un besoin du groupe',
	variants: [linked, separate],
};
