import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';
import { squareShellRank, squareShellStart, squareShellWidth } from './topology-helpers';

export class WideBipartiteLayersScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'wide-bipartite-layers' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		const rank = squareShellRank(nodeIndex);
		const addedRelations = [];
		if (rank > 0) {
			const sourceStart = squareShellStart(rank - 1);
			for (let offset = 0; offset < squareShellWidth(rank - 1); offset += 1) {
				addedRelations.push(
					this.relation(this.nodeId(sourceStart + offset), this.nodeId(nodeIndex)),
				);
			}
		}
		return this.insertion(nodeIndex, rank, { addedRelations });
	}
}
