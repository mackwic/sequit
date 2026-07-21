import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { layoutWithDedicatedEngine } from './dedicated-layout-engine';
import type { LayoutMeasurements, LayoutResult } from './layout-types';

export type {
	Bounds,
	GroupMeasurement,
	LayoutElement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
	Size,
} from './layout-types';

export function layoutGraph(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
): Promise<LayoutResult> {
	return Promise.resolve().then(() => layoutWithDedicatedEngine(graph, ranks, measurements));
}
