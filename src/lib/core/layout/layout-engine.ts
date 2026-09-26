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
import { alignJunctionPorts } from './routing/align-junction-ports';
import {
	allocateLayerPorts,
	materializeLayers,
	planLayeredRouting,
} from './routing/layered-routing';
import { allocatePorts, type PortAllocation } from './routing/port-allocation';
import { planNodeRouting } from './routing/reserve-node-routing';
import { improvesRoutes } from './routing/route-cost';
import { crossingCorridors } from './routing/routing-corridors';
import { directRoutingSpace, routingSpace } from './routing/routing-space';
import { bypassedChains } from './structure/bypassed-chains';
import { type LayoutStructure, prepareLayout } from './structure/prepare-layout';
import { routingLayers } from './structure/routing-layers';

interface PlacementReservation {
	readonly gaps: ReadonlyMap<number, number>;
	readonly channelGaps?: ReadonlyMap<number, readonly number[]>;
}

function alignBranchesWithPorts(workspace: LayoutWorkspace, ports: PortAllocation): void {
	const offsets = new Map<string, number>();
	for (const [id, anchor] of workspace.structure.branchAnchors) {
		const source = ports.sourceOffsets.get(anchor.relationId) ?? 0;
		const target = ports.targetOffsets.get(anchor.relationId) ?? 0;
		offsets.set(id, target - source);
	}
	workspace.placement.branchOffsets = offsets;
}

/** Applying a proposal or restoring its predecessor updates the same placement inputs. */
function placeWithPorts(
	workspace: LayoutWorkspace,
	ports: PortAllocation,
	reservation?: PlacementReservation,
): void {
	alignBranchesWithPorts(workspace, ports);
	for (const [id, size] of ports.sizes) workspace.measurements.sizes.set(id, size);
	placeElements(workspace, reservation?.gaps ?? new Map(), reservation?.channelGaps);
}

function withChainAlignment(
	ports: PortAllocation,
	alignment: ReturnType<typeof alignBypassedChains>,
): PortAllocation {
	if (alignment === undefined) return ports;
	return {
		...ports,
		sizes: new Map([...ports.sizes, ...alignment.sizes]),
		sourceOffsets: new Map([...ports.sourceOffsets, ...alignment.sourceOffsets]),
		targetOffsets: new Map([...ports.targetOffsets, ...alignment.targetOffsets]),
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
	let ports = allocateLayerPorts({
		...input,
		space: directRoutingSpace({
			layers,
			bounds: placement.bounds,
			frame,
			junctionIds: structure.junctionIds,
			enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
		}),
	});
	if (ports === undefined) return undefined;
	placement.transverseCenters = alignment?.centers;
	ports = withChainAlignment(ports, alignment);
	placeWithPorts(workspace, ports);
	let plan = planLayeredRouting(input, ports);
	placeWithPorts(workspace, ports, plan);
	if (structure.junctionIds.size > 0) {
		const originalPorts = ports;
		const originalPlan = plan;
		const originalPaths = materializeLayers(input, plan);
		const proposal = alignJunctionPorts({
			...input,
			vertical: frame.vertical,
			ports,
		});
		placeWithPorts(workspace, proposal, plan);
		ports = alignJunctionPorts({
			...input,
			vertical: frame.vertical,
			ports: originalPorts,
		});
		plan = planLayeredRouting(input, ports);
		placeWithPorts(workspace, ports, plan);
		const fits = [...ports.sizes].every(([id, size]) => {
			const placed = proposal.sizes.get(id);
			return placed?.width === size.width && placed.height === size.height;
		});
		if (!fits || !improvesRoutes(originalPaths, materializeLayers(input, plan))) {
			ports = originalPorts;
			plan = originalPlan;
			placeWithPorts(workspace, ports, plan);
		}
	}
	workspace.routing = {
		ports,
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
	const ports = allocatePorts({
		corridors,
		fromCrossingCorridors: true,
		sizes: measurements.content.nodes,
		vertical: frame.vertical,
		graph,
		bounds: placement.bounds,
	});
	placeWithPorts(workspace, ports, { gaps: baseGaps });
	const routing = planNodeRouting({
		corridors,
		ports,
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
	placeWithPorts(workspace, ports, routing);
}

export interface DedicatedLayoutEvaluation {
	readonly result: LayoutResult;
	/** Inspection is deferred so search trials can be discarded without building diagnostics. */
	complete(): LayoutResult;
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
	if (options.inspectRouting !== true) {
		if (!retainForCompletion) return result;
		return { result, complete: () => result };
	}
	const inspectionInput = {
		layout: result,
		measurements,
		ranks: ranks.byEndpointId,
		direction: frame.direction,
		plan: workspace.routing,
	};
	if (!retainForCompletion)
		return { ...result, routingInspection: inspectRouting(inspectionInput) };
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
	const structure = prepareLayout(graph, ranks);
	return evaluateDedicatedLayout(structure, measurements, options);
}
