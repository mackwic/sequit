import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class BinaryTreeScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'binary-tree' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const parentIndex = Math.floor((nodeIndex - 1) / 2);
		const addedRelations =
			nodeIndex === 0 ? [] : [this.relation(this.nodeId(parentIndex), this.nodeId(nodeIndex))];
		return this.insertion(nodeIndex, Math.floor(Math.log2(nodeIndex + 1)), { addedRelations });
	}
}
