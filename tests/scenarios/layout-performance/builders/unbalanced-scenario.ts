import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';
import { squareShellRank, squareShellStart, squareShellWidth } from './topology-helpers';

export class UnbalancedScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'unbalanced' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const rank = squareShellRank(nodeIndex);
		if (rank === 0) return this.insertion(nodeIndex, rank);

		const targetOffset = nodeIndex - squareShellStart(rank);
		const sourceStart = squareShellStart(rank - 1);
		const sourceWidth = squareShellWidth(rank - 1);
		const dominantTargetCount = Math.ceil(squareShellWidth(rank) * 0.8);
		let sourceOffset = 0;
		if (targetOffset >= dominantTargetCount && sourceWidth > 1) {
			sourceOffset = 1 + ((targetOffset - dominantTargetCount) % (sourceWidth - 1));
		}
		const sourceId = this.nodeId(sourceStart + sourceOffset);
		return this.insertion(nodeIndex, rank, {
			addedRelations: [this.relation(sourceId, this.nodeId(nodeIndex))],
		});
	}
}
