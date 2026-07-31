import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class DisconnectedComponentsScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'disconnected-components' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const isTarget = nodeIndex % 2 === 1;
		return this.insertion(nodeIndex, isTarget ? 1 : 0, {
			addedRelations: isTarget
				? [this.relation(this.nodeId(nodeIndex - 1), this.nodeId(nodeIndex))]
				: [],
		});
	}
}
