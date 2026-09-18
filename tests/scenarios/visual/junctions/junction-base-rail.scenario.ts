import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { junctionClearance, junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { junctionPortPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'junction-base-rail',
	label: 'Une jonction sur le rail de base',
	group: 'Jonctions et rails',
	order: 300,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...junctionFixtures.chain(direction).build(), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.node('a').hasRank(1);
		check.node('b').hasRank(2);
		check.junctions(['j']).areBetween(['a'], ['b'], junctionClearance).areOnBaseRail(['a'], ['b']);
		check.junction('j').isAlignedWith('a', { by: 'chain' }).isAlignedWith('b', { by: 'chain' });
		check
			.ports('j', { role: 'incoming' })
			.haveCount(1)
			.areCentered()
			.haveClearance(junctionPortPolicy);
		check
			.ports('j', { role: 'outgoing' })
			.haveCount(1)
			.areCentered()
			.haveClearance(junctionPortPolicy);
		check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
		check.renderedPaths().haveBridgeAtEveryCrossing();
		check.obstacles().haveClearance(junctionClearance);
	},
};
