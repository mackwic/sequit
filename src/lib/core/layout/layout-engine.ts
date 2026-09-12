import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { buildLayoutResult } from './build-layout-result';
import { createLayoutFrame } from './geometry/layout-frame';
import { inspectRouting } from './inspection/routing-inspection';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from './layout-types';
import type { LayoutWorkspace } from './layout-workspace';
import { expandRowGaps } from './placement/expand-row-gaps';
import { placeElements } from './placement/place-elements';
import { prepareMeasurements } from './placement/prepare-measurements';
import { allocateQuays } from './routing/quay-allocation';
import { planNodeRouting } from './routing/reserve-node-routing';
import { crossingCorridors } from './routing/routing-corridors';
import { prepareLayout } from './structure/prepare-layout';

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
	reserveRouting(workspace, baseGaps);
	const result = buildLayoutResult({
		graph,
		measurements,
		bounds: workspace.placement.bounds,
		routing: workspace.routing,
		frame,
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
