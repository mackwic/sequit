import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import {
	DOCUMENTARY_USE_CASES,
	documentaryUseCases,
	USE_CASES_GROUPS,
} from '../../../support/fixtures/documentary-use-cases';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';
import type { LayoutScenario } from '../scenario';

const TRACEABLE_LAST = DOCUMENTARY_USE_CASES.map((id) => {
	if (id === 'traceable') return 'training';
	if (id === 'training') return 'traceable';
	return id;
});

function crossingFree(layout: VisualLayout): void {
	const check = AssertLayout(layout);
	check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
	check.routes().haveNoCrossing();
}

const reordered: LayoutScenario = {
	id: 'long-relation-reorder-use-cases',
	label: 'ALCOA+ passe du côté de sa note',
	group: 'Rails et ports',
	order: 169,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...documentaryUseCases(direction),
			direction,
			bias,
			groups: USE_CASES_GROUPS,
		});
	},
	assert(layout) {
		crossingFree(layout);
		AssertLayout(layout)
			.node('traceable')
			.isAfter('training', { direction: 'transverse-positive' });
	},
};

const mirrored: LayoutScenario = {
	id: 'long-relation-reorder-mirrored',
	label: 'Ordre documentaire inversé : ALCOA+ passe de l’autre côté',
	group: 'Rails et ports',
	order: 169,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...documentaryUseCases(direction, DOCUMENTARY_USE_CASES.toReversed()),
			direction,
			bias,
			groups: USE_CASES_GROUPS,
		});
	},
	assert(layout) {
		crossingFree(layout);
		AssertLayout(layout)
			.node('training')
			.isAfter('traceable', { direction: 'transverse-positive' });
	},
};

const kept: LayoutScenario = {
	id: 'long-relation-reorder-kept',
	label: 'ALCOA+ déjà du bon côté : l’ordre documentaire est gardé',
	group: 'Rails et ports',
	order: 169,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...documentaryUseCases(direction, TRACEABLE_LAST),
			direction,
			bias,
			groups: USE_CASES_GROUPS,
		});
	},
	assert(layout) {
		crossingFree(layout);
		const check = AssertLayout(layout);
		check.node('training').isAfter('documents-live', { direction: 'transverse-positive' });
		check.node('traceable').isAfter('training', { direction: 'transverse-positive' });
	},
};

export const scenario: LayoutScenario = {
	...reordered,
	id: 'long-relation-reorder',
	label: 'Relation longue : réordonner pour éviter les croisements',
	variants: [reordered, mirrored, kept],
};
