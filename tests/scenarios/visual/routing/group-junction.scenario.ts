import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { layoutGroupJunction } from '../../../support/harnesses/layout-group-junction';
import type { LayoutScenario } from '../scenario';

function variant(groupAsTarget: boolean, nested: boolean): LayoutScenario {
	let id = 'group-junction-source';
	let label = 'Groupe peuplé vers jonction';
	if (groupAsTarget) {
		id = 'group-junction-target';
		label = 'Jonction vers groupe peuplé';
	}
	if (nested) {
		id += '-nested';
		label += ' imbriqué';
	}
	return {
		id,
		label,
		group: 'Rails et ports',
		order: 166,
		arrange(direction = LayoutDirection.TopToBottom, bias) {
			return layoutGroupJunction(direction, bias, groupAsTarget, nested);
		},
		assert(layout) {
			const check = AssertLayout(layout);
			check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
			if (groupAsTarget) check.junction('junction').isAfter('group');
			else check.envelope(['group']).isAfter('junction');
		},
	};
}

export const scenario: LayoutScenario = {
	...variant(false, false),
	id: 'group-junction',
	label: 'Frontière de groupe et jonction extérieure',
	variants: [
		variant(false, false),
		variant(true, false),
		variant(false, true),
		variant(true, true),
	],
};
