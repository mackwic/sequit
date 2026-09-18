import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { junctionClearance, junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { junctionPortPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'junction-crossing-ports',
	label: 'Des troncs entrants communs pour réduire les ponts',
	group: 'Jonctions et rails',
	order: 410,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...junctionFixtures.crossing(direction).build(), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);

		check.nodes(['a', 'b']).haveRank(1);
		check.nodes(['c', 'd', 'e']).haveRank(2);
		check.junctions(['j1', 'j2']).areBetween(['a', 'b'], ['c', 'd', 'e'], junctionClearance);
		check.routes().haveCrossing();
		for (const id of ['j1', 'j2']) {
			check.rails({ between: [[id], ['a', 'b']] }).haveCount(1);
			check
				.ports(id, { role: 'incoming' })
				.haveCount(1)
				.areCentered()
				.haveClearance(junctionPortPolicy);
			check
				.ports(id, { role: 'outgoing' })
				.haveCount(1)
				.areCentered()
				.haveClearance(junctionPortPolicy);
		}
		let content = 28;
		if (axesFor(layout.direction).transverse === 'y') content = 20;
		check.junctions(['j1', 'j2']).haveSizeForUsedPorts({ content, ...junctionPortPolicy });
		check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
		check.renderedPaths().haveBridgeAtEveryCrossing();
		check.renderedPaths().haveBridgeCount(5);
		check.obstacles().haveClearance(junctionClearance);
	},
};
