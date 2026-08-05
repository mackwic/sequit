import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class SubgroupsScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'subgroups' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const groups = [];
		if (nodeIndex === 1) groups.push(this.group(0), this.group(1));
		let groupId: string | undefined;
		if (nodeIndex % 10 !== 0) groupId = this.groupId((nodeIndex - 1) % 2);
		const parentIndex = Math.floor((nodeIndex - 1) / 2);
		const addedRelations = [];
		if (nodeIndex > 0) {
			addedRelations.push(this.relation(this.nodeId(parentIndex), this.nodeId(nodeIndex)));
		}
		return this.insertion(nodeIndex, Math.floor(Math.log2(nodeIndex + 1)), {
			node: this.node(nodeIndex, groupId),
			groups,
			addedRelations,
		});
	}
}
