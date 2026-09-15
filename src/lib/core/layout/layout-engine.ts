import { defined, EndpointKind } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { buildLayoutResult } from './build-layout-result';
import { createLayoutFrame } from './geometry/layout-frame';
import { inspectRouting } from './inspection/routing-inspection';
import type {
	LayoutMeasurements,
	LayoutOptions,
	LayoutResult,
	Point,
	RoutingLayers,
} from './layout-types';
import type { LayoutWorkspace } from './layout-workspace';
import { alignBypassedChains } from './placement/bypassed-chain-alignment';
import { expandRowGaps } from './placement/expand-row-gaps';
import { groupJunctionInsets } from './placement/group-junction-channels';
import { placeElements } from './placement/place-elements';
import { prepareMeasurements } from './placement/prepare-measurements';
import { alignJunctionQuays } from './routing/align-junction-quays';
import {
	allocateLayerQuays,
	materializeLayers,
	planLayeredRouting,
} from './routing/layered-routing';
import { allocateQuays, type QuayAllocation } from './routing/quay-allocation';
import { planNodeRouting } from './routing/reserve-node-routing';
import { improvesRoutes } from './routing/route-cost';
import { crossingCorridors } from './routing/routing-corridors';
import { directRoutingSpace, routingSpace } from './routing/routing-space';
import { bypassedChains } from './structure/bypassed-chains';
import { prepareLayout } from './structure/prepare-layout';
import { routingLayers } from './structure/routing-layers';

interface PlacementReservation {
	readonly gaps: ReadonlyMap<number, number>;
	readonly channelGaps?: ReadonlyMap<number, readonly number[]>;
}

function alignBranchesWithQuays(workspace: LayoutWorkspace, quays: QuayAllocation): void {
	const offsets = new Map<string, number>();
	for (const [id, anchor] of workspace.structure.branchAnchors) {
		const source = quays.sourceOffsets.get(anchor.relationId) ?? 0;
		const target = quays.targetOffsets.get(anchor.relationId) ?? 0;
		offsets.set(id, target - source);
	}
	workspace.placement.branchOffsets = offsets;
}

/** Applying a proposal or restoring its predecessor updates the same placement inputs. */
function placeWithQuays(
	workspace: LayoutWorkspace,
	quays: QuayAllocation,
	reservation?: PlacementReservation,
): void {
	alignBranchesWithQuays(workspace, quays);
	for (const [id, size] of quays.sizes) workspace.measurements.sizes.set(id, size);
	placeElements(workspace, reservation?.gaps ?? new Map(), reservation?.channelGaps);
}

function withChainAlignment(
	quays: QuayAllocation,
	alignment: ReturnType<typeof alignBypassedChains>,
): QuayAllocation {
	if (alignment === undefined) return quays;
	return {
		sizes: new Map([...quays.sizes, ...alignment.sizes]),
		sourceOffsets: new Map([...quays.sourceOffsets, ...alignment.sourceOffsets]),
		targetOffsets: new Map([...quays.targetOffsets, ...alignment.targetOffsets]),
	};
}

function reserveLayeredRouting(
	workspace: LayoutWorkspace,
	layers: RoutingLayers,
): ReadonlyMap<string, readonly Point[]> | undefined {
	const { structure, measurements, placement, frame } = workspace;
	if (structure.junctionIds.size === 0 && structure.maximumRank <= 1) return undefined;
	const skipsOrdinaryRows =
		structure.junctionIds.size === 0 &&
		structure.graph.relations.some(({ relation, source, target }) => {
			if (source.kind === EndpointKind.Group || target.kind === EndpointKind.Group) return false;
			const sourceRank = defined(structure.ranks.byEndpointId.get(relation.from));
			const targetRank = defined(structure.ranks.byEndpointId.get(relation.to));
			return sourceRank > targetRank + 1;
		});
	if (structure.junctionIds.size === 0 && !skipsOrdinaryRows) return undefined;
	const alignment = alignBypassedChains(
		bypassedChains(structure.graph, structure.components, structure.ranks.byEndpointId),
		measurements.sizes,
		frame.vertical,
	);
	const input = {
		graph: structure.graph,
		layers,
		bounds: placement.bounds,
		frame,
		ranks: structure.ranks.byEndpointId,
		junctionIds: structure.junctionIds,
		sizes: measurements.sizes,
		componentByEndpointId: new Map(
			structure.components.flatMap((component, index) =>
				component.ids.map((id) => [id, index] as const),
			),
		),
	};
	let quays = allocateLayerQuays({
		...input,
		space: directRoutingSpace({
			layers,
			bounds: placement.bounds,
			frame,
			junctionIds: structure.junctionIds,
			enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
		}),
	});
	if (quays === undefined) return undefined;
	placement.transverseCenters = alignment?.centers;
	quays = withChainAlignment(quays, alignment);
	placeWithQuays(workspace, quays);
	let plan = planLayeredRouting(input, quays);
	placeWithQuays(workspace, quays, plan);
	if (structure.junctionIds.size > 0) {
		const originalQuays = quays;
		const originalPlan = plan;
		const originalPaths = materializeLayers(input, plan);
		const proposal = alignJunctionQuays({
			...input,
			vertical: frame.vertical,
			quays,
		});
		placeWithQuays(workspace, proposal, plan);
		quays = alignJunctionQuays({
			...input,
			vertical: frame.vertical,
			quays: originalQuays,
		});
		plan = planLayeredRouting(input, quays);
		placeWithQuays(workspace, quays, plan);
		const fits = [...quays.sizes].every(([id, size]) => {
			const placed = proposal.sizes.get(id);
			return placed?.width === size.width && placed.height === size.height;
		});
		if (!fits || !improvesRoutes(originalPaths, materializeLayers(input, plan))) {
			quays = originalQuays;
			plan = originalPlan;
			placeWithQuays(workspace, quays, plan);
		}
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
	placeWithQuays(workspace, quays, { gaps: baseGaps });
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
	placeWithQuays(workspace, quays, routing);
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
		placement: {
			bounds: new Map(),
			components: [],
			groupChannelInsets: new Map(),
		},
		routing: undefined,
	};
	const baseGaps = new Map<number, number>();
	placeElements(workspace, baseGaps);
	workspace.placement.groupChannelInsets = groupJunctionInsets(
		structure,
		workspace.placement.bounds,
		frame,
	);
	if (workspace.placement.groupChannelInsets.size > 0) placeElements(workspace, baseGaps);
	const layers = routingLayers(structure);
	const routes = reserveLayeredRouting(workspace, layers);
	if (routes === undefined) reserveRouting(workspace, baseGaps);
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
