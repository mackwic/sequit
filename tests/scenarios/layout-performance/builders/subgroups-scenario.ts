import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class SubgroupsScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'subgroups' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const groups = nodeIndex === 1 ? [this.group(0), this.group(1)] : [];
		const groupId = nodeIndex % 10 === 0 ? undefined : this.groupId((nodeIndex - 1) % 2);
		const parentIndex = Math.floor((nodeIndex - 1) / 2);
		const addedRelations =
			nodeIndex === 0 ? [] : [this.relation(this.nodeId(parentIndex), this.nodeId(nodeIndex))];
		return this.insertion(nodeIndex, Math.floor(Math.log2(nodeIndex + 1)), {
			node: this.node(nodeIndex, groupId),
			groups,
			addedRelations,
		});
	}
}
