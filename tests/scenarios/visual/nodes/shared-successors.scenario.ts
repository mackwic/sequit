import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'shared-successors',
	label: 'Deux parents et deux successeurs communs',
	group: 'Successeurs et enveloppes',
	order: 90,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures.sharedSuccessors().build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.nodes(['a', 'b']).haveRank(1);
		check.nodes(['c', 'd']).haveRank(2);
		check.envelope(['c', 'd']).isCenteredOn(layout.envelopeOf(['a', 'b']), { axis: 'transverse' });
		check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
		check.routes(['a-to-d', 'b-to-c']).haveCrossing();
		check.renderedPaths().haveBridgeAtEveryCrossing();
	},
};
