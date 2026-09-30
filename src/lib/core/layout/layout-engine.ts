import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { buildLayoutResult } from './build-layout-result';
import { createLayoutFrame } from './geometry/layout-frame';
import { inspectRouting } from './inspection/routing-inspection';
import { layeredRoutingComponents } from './layout-routing-components';
import { reserveLayeredRouting } from './layout-routing-layers';
import { reserveMixedRouting, reserveRouting } from './layout-routing-mixed';
import type {
	DedicatedLayoutEvaluation,
	LayoutMeasurements,
	LayoutOptions,
	LayoutResult,
	Point,
} from './layout-types';
import type { LayoutWorkspace } from './layout-workspace';
import { groupJunctionInsets } from './placement/group-junction-channels';
import { placeElements } from './placement/place-elements';
import { prepareMeasurements } from './placement/prepare-measurements';
import { selectDedicatedRankLayout } from './rank/rank-order-selection';
import type { RankOrderSearchWitness } from './rank/rank-order-witness';
import type { ChannelRoutingCache } from './routing/channel-routing-cache';
import { routingSpace } from './routing/routing-space';
import type { LayoutStructure } from './structure/prepare-layout';
import { routingLayers } from './structure/routing-layers';

/** Borrowed from the projection that owns them; a layout call never owns their state. */
export interface DedicatedLayoutCaches {
	readonly channels: ChannelRoutingCache;
}

export function evaluateDedicatedLayout(
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	options?: LayoutOptions,
): LayoutResult;
export function evaluateDedicatedLayout(
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	options: LayoutOptions | undefined,
	retainForCompletion: true,
): DedicatedLayoutEvaluation;
export function evaluateDedicatedLayout(
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
	retainForCompletion = false,
): LayoutResult | DedicatedLayoutEvaluation {
	const evaluation = evaluateRetainedLayout(structure, measurements, options, undefined);
	if (retainForCompletion) return evaluation;
	return evaluation.complete();
}

function evaluateRetainedLayout(
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	options: LayoutOptions,
	channels: ChannelRoutingCache | undefined,
): DedicatedLayoutEvaluation {
	const graph = structure.graph;
	const ranks = structure.ranks;
	const frame = createLayoutFrame(graph.document.layout.direction, graph.document.layout.bias);
	const workspace: LayoutWorkspace = {
		structure,
		frame,
		measurements: prepareMeasurements(structure, measurements, frame),
		placement: {
			bounds: new Map(),
			components: [],
			groupChannelInsets: new Map(),
		},
		routing: undefined,
		channels,
	};
	const baseGaps = new Map<number, number>();
	placeElements(workspace, baseGaps);
	workspace.placement.groupChannelInsets = groupJunctionInsets(
		structure,
		workspace.placement.bounds,
		frame,
	);
	if (workspace.placement.groupChannelInsets.size > 0) {
		delete workspace.placement.groupWindows;
		placeElements(workspace, baseGaps);
	}
	const layers = routingLayers(structure);
	const layered = layeredRoutingComponents(structure);
	const layeredComponents = structure.components.filter((component) => layered.has(component));
	const normalComponents = structure.components.filter((component) => !layered.has(component));
	let routes: ReadonlyMap<string, readonly Point[]> | undefined;
	if (layeredComponents.length === 0) reserveRouting(workspace, baseGaps);
	else if (
		normalComponents.every((component) =>
			component.ids.every((id) => graph.outgoingByEndpointId.get(id)?.length === 0),
		) ||
		structure.junctionIds.size === 0
	) {
		const layered = reserveLayeredRouting(workspace, layers);
		if (layered === undefined) reserveRouting(workspace, baseGaps);
		else routes = layered.materialize();
	} else {
		routes = reserveMixedRouting(workspace, baseGaps, layeredComponents, normalComponents);
	}
	const space = routingSpace({
		layers,
		bounds: workspace.placement.bounds,
		frame,
		enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
	});
	const result = buildLayoutResult({
		graph,
		bounds: workspace.placement.bounds,
		routing: workspace.routing,
		frame,
		routes,
		space,
	});
	if (options.inspectRouting !== true) return { result, complete: () => result };
	const inspectionInput = {
		layout: result,
		measurements,
		ranks: ranks.byEndpointId,
		direction: frame.direction,
		plan: workspace.routing,
	};
	return {
		result,
		complete: () => ({
			...result,
			routingInspection: inspectRouting(inspectionInput),
		}),
	};
}

export function layoutWithDedicatedEngine(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
): LayoutResult {
	return selectDedicatedRankLayout(graph, ranks, measurements, {
		options,
		evaluate: evaluateDedicatedLayout,
	}).layout;
}

/** Every rank-order evaluation of this projection layout routes through its channel cache. */
export function layoutWithDedicatedEngineForProjection(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	caches: DedicatedLayoutCaches,
): LayoutResult {
	return selectDedicatedRankLayout(graph, ranks, measurements, {
		options: {},
		evaluate: (structure, measured, options) =>
			evaluateRetainedLayout(structure, measured, options ?? {}, caches.channels),
	}).layout;
}

/** The same production selection, exposing its transient proof to workshop consumers. */
export function layoutWithDedicatedEngineAndRankOrderWitness(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
): { readonly layout: LayoutResult; readonly witness: RankOrderSearchWitness } {
	return selectDedicatedRankLayout(graph, ranks, measurements, {
		options,
		evaluate: evaluateDedicatedLayout,
	});
}
