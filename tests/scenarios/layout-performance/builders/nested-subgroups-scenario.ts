import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class NestedSubgroupsScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'nested-subgroups' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const groupId = this.groupId(nodeIndex);
		let parentGroupId: string | undefined;
		if (nodeIndex > 0) parentGroupId = this.groupId(nodeIndex - 1);
		const groups = [this.group(nodeIndex, parentGroupId)];
		const addedRelations = [];
		if (nodeIndex > 0) {
			addedRelations.push(this.relation(this.nodeId(nodeIndex - 1), this.nodeId(nodeIndex)));
		}
		return this.insertion(nodeIndex, nodeIndex, {
			node: this.node(nodeIndex, groupId),
			groups,
			addedRelations,
		});
	}
}
