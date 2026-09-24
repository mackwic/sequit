import type { LogicGraph } from '../graph/create-graph';
import type { LayoutMeasurements, LayoutOptions } from './layout-types';
import type { NestedRegionLocalLayoutCache } from './nested-region-local-cache';
import { solveRecursiveNestedRegionLayout } from './nested-region-recursive-layout';
import {
	type NestedRegionInput,
	type NestedRegionLayoutAttempt,
	NestedRegionLayoutStatus,
} from './nested-region-types';

/** A projection may supply its own bounded leaf-layout cache. */
export interface NestedRegionExecutionContext {
	readonly options: LayoutOptions;
	readonly cache?: NestedRegionLocalLayoutCache;
}

export function solveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: NestedRegionInput,
	context: NestedRegionExecutionContext,
): NestedRegionLayoutAttempt;
export function solveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: NestedRegionInput,
	options?: LayoutOptions,
): NestedRegionLayoutAttempt;
export function solveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: NestedRegionInput,
	optionsOrContext: LayoutOptions | NestedRegionExecutionContext = {},
): NestedRegionLayoutAttempt {
	let execution: NestedRegionExecutionContext;
	if ('options' in optionsOrContext) execution = optionsOrContext;
	else execution = { options: optionsOrContext };
	if (execution.options.inspectRouting === true)
		return {
			status: NestedRegionLayoutStatus.Unsupported,
			reason: 'Combined routing inspection is not available.',
		};
	return solveRecursiveNestedRegionLayout(graph, measurements, input, execution.cache);
}

/** Projection-owned cache only; the public solver keeps its ordinary options API. */
export function solveNestedRegionLayoutForProjection(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: NestedRegionInput,
	cache: NestedRegionLocalLayoutCache,
): NestedRegionLayoutAttempt {
	return solveNestedRegionLayout(graph, measurements, input, {
		options: {},
		cache,
	});
}
