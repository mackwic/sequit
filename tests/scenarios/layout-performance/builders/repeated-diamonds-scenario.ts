import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class RepeatedDiamondsScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'repeated-diamonds' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		if (nodeIndex === 0) return this.insertion(nodeIndex, 0);
		const motifOffset = (nodeIndex - 1) % 3;
		const motifStart = nodeIndex - motifOffset;
		const motif = Math.floor((nodeIndex - 1) / 3);
		let rankOffset = 1;
		let fromIndices = [motifStart - 1];
		if (motifOffset === 2) {
			rankOffset = 2;
			fromIndices = [nodeIndex - 2, nodeIndex - 1];
		}
		const nodeRank = motif * 2 + rankOffset;
		return this.insertion(nodeIndex, nodeRank, {
			addedRelations: fromIndices.map((fromIndex) =>
				this.relation(this.nodeId(fromIndex), this.nodeId(nodeIndex)),
			),
		});
	}
}
