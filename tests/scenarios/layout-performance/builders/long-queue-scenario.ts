import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class LongQueueScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'long-queue' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const addedRelations =
			nodeIndex === 0 ? [] : [this.relation(this.nodeId(nodeIndex - 1), this.nodeId(nodeIndex))];
		return this.insertion(nodeIndex, nodeIndex, { addedRelations });
	}
}
