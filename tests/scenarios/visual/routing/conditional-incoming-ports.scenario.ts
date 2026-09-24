import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { portPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

/** The same four relations need different face capacity when the two targets exchange order. */
function orderedTargets(crossed: boolean): LayoutScenario {
	let id = 'conditional-incoming-ports-shared';
	let label = 'E avant D : port partagé';
	let nodeIds = ['a', 'b', 'c', 'e', 'd'];
	let incomingPorts = 1;
	if (crossed) {
		id = 'conditional-incoming-ports-crossed';
		label = 'D avant E : trois ports et deux croisements';
		nodeIds = ['a', 'b', 'c', 'd', 'e'];
		incomingPorts = 3;
	}
	return {
		id,
		label,
		group: 'Rails et ports',
		order: 162,
		arrange(direction = LayoutDirection.TopToBottom, bias) {
			return layoutNodes({
				...graphFixtures
					.routingNodes(nodeIds, direction)
					.arrowsFrom('a', ['d', 'e'])
					.arrowsFrom('b', ['d'])
					.arrowsFrom('c', ['d'])
					.build(),
				direction,
				bias,
			});
		},
		assert(layout) {
			const check = AssertLayout(layout);
			check.nodes(['a', 'b', 'c']).haveRank(2);
			check.nodes(['d', 'e']).haveRank(1);
			if (crossed) check.node('e').isAfter('d', { direction: 'transverse-positive' });
			else check.node('d').isAfter('e', { direction: 'transverse-positive' });
			check
				.ports('d', { role: 'incoming' })
				.haveCount(incomingPorts)
				.areCentered()
				.haveClearance(portPolicy);
			check.node('d').hasSizeForPorts({
				content: 80,
				incoming: incomingPorts,
				outgoing: 0,
				...portPolicy,
			});
			check
				.routes()
				.areOrthogonal()
				.areAttachedToEndpoints()
				.followLayoutFlow()
				.haveOnlyAllowedSharedTrunks();
			if (crossed) {
				check.routes().haveCrossing();
				check.renderedPaths().haveBridgeAtEveryCrossing();
			} else check.routes().haveNoCrossing();
		},
	};
}

export const scenario: LayoutScenario = {
	...orderedTargets(true),
	id: 'conditional-incoming-ports',
	label: 'Ordre des cibles et capacité des ports entrants',
	variants: [orderedTargets(true), orderedTargets(false)],
};
