import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { portPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

/** Dense variants retain exactly the same relations; only the target document order changes. */
function orderedTargets(crossed: boolean, reversedDense = false): LayoutScenario {
	let id = 'conditional-incoming-ports-shared';
	let label = 'Quatre relations, E avant D : port partagé';
	let nodeIds = ['a', 'b', 'c', 'e', 'd'];
	let incomingPorts = 1;
	let predecessorTargets = ['d'];
	if (crossed) {
		id = 'conditional-incoming-ports-crossed';
		label = 'Six relations, D avant E : trois ports';
		if (reversedDense) {
			id = 'conditional-incoming-ports-dense-reordered';
			label = 'Six relations, E avant D : toujours trois ports';
		} else nodeIds = ['a', 'b', 'c', 'd', 'e'];
		incomingPorts = 3;
		predecessorTargets = ['d', 'e'];
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
					.arrowsFrom('b', predecessorTargets)
					.arrowsFrom('c', predecessorTargets)
					.build(),
				direction,
				bias,
			});
		},
		assert(layout) {
			const check = AssertLayout(layout);
			check.nodes(['a', 'b', 'c']).haveRank(2);
			check.nodes(['d', 'e']).haveRank(1);
			if (crossed && !reversedDense)
				check.node('e').isAfter('d', { direction: 'transverse-positive' });
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
	label: 'Topologie des relations et invariance des ports sous inversion des cibles',
	variants: [orderedTargets(true), orderedTargets(true, true), orderedTargets(false)],
};
