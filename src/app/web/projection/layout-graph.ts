import type { LogicGraph } from '../../../lib/core/graph/create-graph';
import type { TopologicalRanks } from '../../../lib/core/graph/topological-ranks';
import type {
	LayoutMeasurements,
	LayoutOptions,
	LayoutResult,
} from '../../../lib/core/layout/layout-types';
import { RegionLocalLayoutCache } from '../../../lib/core/layout/regions/model/region-local-cache';
import {
	layoutWithRootRegion,
	layoutWithRootRegionForProjection,
	type ProjectionLayoutCaches,
} from '../../../lib/core/layout/root-region';
import { ChannelRoutingCache } from '../../../lib/core/layout/routing/channel-routing-cache';

export type {
	Bounds,
	GroupMeasurement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
	Size,
} from '../../../lib/core/layout/layout-types';

/** Cold: nothing survives the call. */
export function layoutGraph(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
): Promise<LayoutResult> {
	return Promise.resolve().then(() => layoutWithRootRegion(graph, ranks, measurements, options));
}

/** The caches of one opened document; they live and die with its projection. */
export function createProjectionLayoutCaches(): ProjectionLayoutCaches {
	return { regions: new RegionLocalLayoutCache(), channels: new ChannelRoutingCache() };
}

/**
 * Reuse local child layouts of nested regions and exact channel routings of the dedicated root
 * from the previous layouts of an opened projection; the result equals `layoutGraph`.
 */
export function layoutGraphForProjection(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	caches: ProjectionLayoutCaches,
): Promise<LayoutResult> {
	return Promise.resolve().then(() =>
		layoutWithRootRegionForProjection(graph, ranks, measurements, caches),
	);
}
