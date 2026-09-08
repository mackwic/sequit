import { LayoutPerformanceScenarioBuilder } from '../layout-performance-scenario-builder';
import type { LayoutPerformanceInsertion } from '../scenario-types';

export class JunctionHeavyScenarioBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'junction-heavy' as const;

	protected insertNode(nodeIndex: number): LayoutPerformanceInsertion {
		if (nodeIndex === 0) return this.insertion(nodeIndex, 0);
		const junction = this.junction(nodeIndex - 1);
		// Production currently increments every edge; zero increment into junctions is a future change.
		return this.insertion(nodeIndex, nodeIndex, {
			junctions: [junction],
			addedRelations: [
				this.relation(this.nodeId(nodeIndex - 1), junction.id),
				this.relation(junction.id, this.nodeId(nodeIndex)),
			],
		});
	}
}
