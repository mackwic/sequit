import type { LayoutMeasurements } from '../../../../src/app/web/projection/layout-graph';
import type { LayoutPerformanceSnapshot } from '../../../../src/app/workshop/fixtures/layout-performance/scenario-types';
import type { LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import type { TopologicalRanks } from '../../../../src/lib/core/graph/topological-ranks';

export interface PreparedLayoutPerformanceScenario extends LayoutPerformanceSnapshot {
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
}
