import type { LayoutPerformanceSnapshot } from '../../../src/lib/fixtures/layout-performance/scenario-types';
import type { LogicGraph } from '../../../src/lib/graph/create-graph';
import type { TopologicalRanks } from '../../../src/lib/graph/topological-ranks';
import type { LayoutMeasurements } from '../../../src/lib/layout/layout-graph';

export interface PreparedLayoutPerformanceScenario extends LayoutPerformanceSnapshot {
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
}
