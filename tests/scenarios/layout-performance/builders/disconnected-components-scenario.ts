import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class DisconnectedComponentsScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'disconnected-components' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const isTarget = nodeIndex % 2 === 1;
		let rank = 0;
		const addedRelations = [];
		if (isTarget) {
			rank = 1;
			addedRelations.push(this.relation(this.nodeId(nodeIndex - 1), this.nodeId(nodeIndex)));
		}
		return this.insertion(nodeIndex, rank, { addedRelations });
	}
}
