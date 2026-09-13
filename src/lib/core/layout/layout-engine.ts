import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { buildLayoutResult } from './build-layout-result';
import { createLayoutFrame } from './geometry/layout-frame';
import { inspectRouting } from './inspection/routing-inspection';
import type { LayoutMeasurements, LayoutOptions, LayoutResult, Point } from './layout-types';
import type { LayoutWorkspace } from './layout-workspace';
import { expandRowGaps } from './placement/expand-row-gaps';
import { placeElements } from './placement/place-elements';
import { prepareMeasurements } from './placement/prepare-measurements';
import { alignJunctionQuays } from './routing/align-junction-quays';
import {
	allocateLayerQuays,
	materializeLayers,
	planLayeredRouting,
} from './routing/layered-routing';
import { allocateQuays } from './routing/quay-allocation';
import { planNodeRouting } from './routing/reserve-node-routing';
import { improvesRoutes } from './routing/route-cost';
import { crossingCorridors } from './routing/routing-corridors';
import { prepareLayout } from './structure/prepare-layout';
import { routingLayers } from './structure/routing-layers';

function reserveLayeredRouting(
	workspace: LayoutWorkspace,
): ReadonlyMap<string, readonly Point[]> | undefined {
	const { structure, measurements, placement, frame } = workspace;
	if (structure.junctionIds.size === 0) return undefined;
	const input = {
		graph: structure.graph,
		layers: routingLayers(structure),
		bounds: placement.bounds,
		frame,
		ranks: structure.ranks.byEndpointId,
		junctionIds: structure.junctionIds,
		sizes: measurements.sizes,
	};
	let quays = allocateLayerQuays(input);
	if (quays === undefined) return undefined;
	for (const [id, size] of quays.sizes) measurements.sizes.set(id, size);
	placeElements(workspace, new Map());
	let plan = planLayeredRouting(input, quays);
	placeElements(workspace, plan.gaps, plan.channelGaps);
	const originalQuays = quays;
	const originalPlan = plan;
	const originalPaths = materializeLayers(input, plan);
	const proposal = alignJunctionQuays({ ...input, vertical: frame.vertical, quays });
	for (const [id, size] of proposal.sizes) measurements.sizes.set(id, size);
	placeElements(workspace, plan.gaps, plan.channelGaps);
	quays = alignJunctionQuays({ ...input, vertical: frame.vertical, quays: originalQuays });
	plan = planLayeredRouting(input, quays);
	placeElements(workspace, plan.gaps, plan.channelGaps);
	const fits = [...quays.sizes].every(([id, size]) => {
		const placed = proposal.sizes.get(id);
		return placed?.width === size.width && placed.height === size.height;
	});
	if (!fits || !improvesRoutes(originalPaths, materializeLayers(input, plan))) {
		quays = originalQuays;
		plan = originalPlan;
		for (const [id, size] of quays.sizes) measurements.sizes.set(id, size);
		placeElements(workspace, plan.gaps, plan.channelGaps);
	}
	workspace.routing = {
		quays,
		gaps: plan.gaps,
		ranks: structure.ranks.byEndpointId,
		corridors: [],
		railCounts: new Map(),
	};
	return materializeLayers(input, plan);
}

function reserveRouting(workspace: LayoutWorkspace, baseGaps: ReadonlyMap<number, number>): void {
	const { structure, measurements, frame, placement } = workspace;
	const { graph, ranks } = structure;
	const corridors = crossingCorridors({
		graph,
		ranks: ranks.byEndpointId,
		bounds: placement.bounds,
		vertical: frame.vertical,
	});
	if (corridors.length === 0) return;
	const quays = allocateQuays({
		corridors,
		sizes: measurements.content.nodes,
		vertical: frame.vertical,
		graph,
		bounds: placement.bounds,
	});
	for (const [id, size] of quays.sizes) measurements.sizes.set(id, size);
	placeElements(workspace, baseGaps);
	const routing = planNodeRouting({
		corridors,
		quays,
		bounds: placement.bounds,
		vertical: frame.vertical,
		ranks: ranks.byEndpointId,
	});
	workspace.routing = routing;
	if (structure.hierarchy === undefined && structure.junctionIds.size === 0) {
		expandRowGaps({
			bounds: placement.bounds,
			ranks: ranks.byEndpointId,
			gaps: routing.gaps,
			maximumRank: structure.maximumRank,
			frame,
		});
		return;
	}
	placeElements(workspace, routing.gaps);
}

export function layoutWithDedicatedEngine(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
): LayoutResult {
	const structure = prepareLayout(graph, ranks);
	const frame = createLayoutFrame(graph.document.layout.direction, graph.document.layout.bias);
	const workspace: LayoutWorkspace = {
		structure,
		frame,
		measurements: prepareMeasurements(structure, measurements, frame),
		placement: { bounds: new Map(), components: [] },
		routing: undefined,
	};
	const baseGaps = new Map<number, number>();
	placeElements(workspace, baseGaps);
	const routes = reserveLayeredRouting(workspace);
	if (routes === undefined) reserveRouting(workspace, baseGaps);
	const result = buildLayoutResult({
		graph,
		bounds: workspace.placement.bounds,
		routing: workspace.routing,
		frame,
		routes,
	});
	if (options.inspectRouting !== true) return result;
	return {
		...result,
		routingInspection: inspectRouting({
			layout: result,
			measurements,
			ranks: ranks.byEndpointId,
			direction: frame.direction,
			plan: workspace.routing,
		}),
	};
}
