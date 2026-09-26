import type { LogicGraph } from '../graph/create-graph';
import type { LayoutMeasurements, LayoutOptions } from './layout-types';
import { solveRecursiveNestedRegionLayout } from './nested-region-recursive-layout';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutAttempt,
} from './regions/model/region-composition-types';
import type { RegionLocalLayoutCache } from './regions/model/region-local-cache';

/** A projection may supply its own bounded leaf-layout cache. */
export interface RegionExecutionContext {
	readonly options: LayoutOptions;
	readonly cache?: RegionLocalLayoutCache;
}

export function solveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: RegionInput,
	context: RegionExecutionContext,
): RegionLayoutAttempt;
export function solveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: RegionInput,
	options?: LayoutOptions,
): RegionLayoutAttempt;
export function solveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: RegionInput,
	optionsOrContext: LayoutOptions | RegionExecutionContext = {},
): RegionLayoutAttempt {
	let execution: RegionExecutionContext;
	if ('options' in optionsOrContext) execution = optionsOrContext;
	else execution = { options: optionsOrContext };
	if (execution.options.inspectRouting === true)
		return {
			status: RegionCompositionStatus.Unsupported,
			reason: 'Combined routing inspection is not available.',
		};
	return solveRecursiveNestedRegionLayout(graph, measurements, input, execution.cache);
}

/** Projection-owned cache only; the public solver keeps its ordinary options API. */
export function solveNestedRegionLayoutForProjection(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: RegionInput,
	cache: RegionLocalLayoutCache,
): RegionLayoutAttempt {
	return solveNestedRegionLayout(graph, measurements, input, {
		options: {},
		cache,
	});
}
