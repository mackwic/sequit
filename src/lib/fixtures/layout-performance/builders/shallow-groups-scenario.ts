import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class ShallowGroupsScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'shallow-groups' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const atRoot = nodeIndex % 10 === 0;
		const groupIndex = Math.floor(nodeIndex / 10);
		const groups = [];
		const startsGroup = nodeIndex % 10 === 1;
		if (startsGroup) groups.push(this.group(groupIndex));
		const parentIndex = Math.floor((nodeIndex - 1) / 2);
		let groupId: string | undefined;
		if (!atRoot) groupId = this.groupId(groupIndex);
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
