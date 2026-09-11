import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';
import { squareShellRank, squareShellStart } from './topology-helpers';

export class GroupRelationsScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'group-relations' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const rank = squareShellRank(nodeIndex);
		const startsGroup = nodeIndex === squareShellStart(rank);
		const group = this.group(rank);
		// Production expands each group relation across its descendant members.
		const addedRelations = [];
		if (startsGroup && rank > 0) {
			addedRelations.push(this.relation(this.groupId(rank - 1), this.groupId(rank)));
		}
		const groups = [];
		if (startsGroup) groups.push(group);
		return this.insertion(nodeIndex, rank, {
			node: this.node(nodeIndex, group.id),
			groups,
			addedRelations,
		});
	}
}
