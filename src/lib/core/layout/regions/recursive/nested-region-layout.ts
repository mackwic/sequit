import type { LogicGraph } from '../../../graph/create-graph';
import type { LayoutMeasurements, LayoutOptions } from '../../layout-types';
import type { RegionCompositionWork } from '../model/region-composition-limits';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutAttempt,
} from '../model/region-composition-types';
import type { RegionLocalLayoutCache } from '../model/region-local-cache';
import { solveRecursiveNestedRegionLayoutWithWork } from './nested-region-recursive-layout';

/** A projection may supply its own bounded leaf-layout cache. */
export interface RegionExecutionContext {
	readonly options: LayoutOptions;
	readonly cache?: RegionLocalLayoutCache;
	readonly work?: RegionCompositionWork;
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
	return solveRecursiveNestedRegionLayoutWithWork(graph, measurements, input, {
		cache: execution.cache,
		work: execution.work,
	});
}

/** Projection-owned cache and monotone work envelope; public solver options stay unchanged. */
export function solveNestedRegionLayoutForProjection(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: RegionInput,
	cache: RegionLocalLayoutCache,
	work?: RegionCompositionWork,
): RegionLayoutAttempt {
	return solveNestedRegionLayout(graph, measurements, input, {
		options: {},
		cache,
		work,
	});
}
