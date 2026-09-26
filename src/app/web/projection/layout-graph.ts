import type { LogicGraph } from '../../../lib/core/graph/create-graph';
import type { TopologicalRanks } from '../../../lib/core/graph/topological-ranks';
import type {
	LayoutMeasurements,
	LayoutOptions,
	LayoutResult,
} from '../../../lib/core/layout/layout-types';
import type { RegionLocalLayoutCache } from '../../../lib/core/layout/regions/model/region-local-cache';
import {
	layoutWithRootRegion,
	layoutWithRootRegionForProjection,
} from '../../../lib/core/layout/root-region';

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
	options: LayoutOptions = {},
): Promise<LayoutResult> {
	return Promise.resolve().then(() => layoutWithRootRegion(graph, ranks, measurements, options));
}

/** Reuse local child layouts only for the nested-region policy of an opened projection. */
export function layoutGraphForProjection(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	cache: RegionLocalLayoutCache,
): Promise<LayoutResult> {
	return Promise.resolve().then(() =>
		layoutWithRootRegionForProjection(graph, ranks, measurements, cache),
	);
}
