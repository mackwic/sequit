import type { LogicGraph } from '../../../lib/core/graph/create-graph';
import type { TopologicalRanks } from '../../../lib/core/graph/topological-ranks';
import { layoutWithDedicatedEngine } from '../../../lib/core/layout/dedicated-layout-engine';
import type { LayoutMeasurements, LayoutResult } from '../../../lib/core/layout/layout-types';

export type {
	Bounds,
	GroupMeasurement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
	Size,
} from '../../../lib/core/layout/layout-types';

export function layoutGraph(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
): Promise<LayoutResult> {
	return Promise.resolve().then(() => layoutWithDedicatedEngine(graph, ranks, measurements));
}
