import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { layoutGroupSidePort } from '../../../support/harnesses/layout-group-side-port';
import type { LayoutScenario } from '../scenario';

function groupSidePort(withSibling: boolean, groupAsTarget = false): LayoutScenario {
	let id = 'group-side-port-minimal';
	let label = 'Un groupe et un nœud (minimum)';
	if (withSibling) {
		id = 'group-side-port-with-sibling';
		label = 'Avec un second enfant (capture)';
	}
	if (groupAsTarget) {
		id = 'group-side-port-target';
		label = 'Un nœud vers un groupe (arrivée)';
	}
	return {
		id,
		label,
		group: 'Rails et ports',
		order: 165,
		arrange(direction = LayoutDirection.TopToBottom, bias) {
			return layoutGroupSidePort(withSibling, direction, bias, groupAsTarget);
		},
		assert(layout) {
			AssertLayout(layout).routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
		},
	};
}

export const scenario: LayoutScenario = {
	...groupSidePort(false),
	id: 'group-side-port',
	label: 'Groupe vide : départ interdit sur le côté',
	variants: [groupSidePort(false), groupSidePort(true), groupSidePort(false, true)],
};
