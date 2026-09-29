import { defined } from '../document/logic-document';
import { withChainAlignment } from './layout-port-placement';
import {
	type LayoutRoutingWorkspace,
	mergeReservations,
	placeWithRoutingPorts,
	type RoutingReservation,
	scopePortAllocation,
} from './layout-routing-components';
import type { Point, RoutingLayers } from './layout-types';
import { alignBypassedChains } from './placement/bypassed-chain-alignment';
import { alignJunctionPorts } from './routing/align-junction-ports';
import { allocateLayerPorts } from './routing/layered-port-reservation';
import { type LayerPlan, materializeLayers, planLayeredRouting } from './routing/layered-routing';
import type { PortAllocation } from './routing/port-allocation';
import type { NodeRouting } from './routing/reserve-node-routing';
import { improvesRoutes } from './routing/route-cost';
import { directRoutingSpace } from './routing/routing-space';
import { bypassedChains } from './structure/bypassed-chains';
import { weaklyConnectedComponents } from './structure/layout-components';
import type { LayoutStructure } from './structure/prepare-layout';
export interface LayeredRoutingResult {
	readonly materialize: () => ReadonlyMap<string, readonly Point[]>;
	readonly reservation: RoutingReservation;
	readonly routing: NodeRouting;
}

interface LayerState {
	readonly ports: PortAllocation;
	readonly plan: LayerPlan;
	readonly reservation: RoutingReservation;
	readonly base: RoutingReservation;
}

function reservedPlan(
	plan: LayerPlan,
	base: RoutingReservation,
	scoped: boolean,
): RoutingReservation {
	if (scoped) return mergeReservations(base, plan);
	return plan;
}

function alignLayeredJunctions(
	workspace: LayoutRoutingWorkspace,
	structure: LayoutStructure,
	input: Parameters<typeof planLayeredRouting>[0],
	state: LayerState,
): LayerState {
	const scoped = workspace.structure !== structure;
	const originalPaths = materializeLayers(input, state.plan);
	let proposal = alignJunctionPorts({
		...input,
		vertical: workspace.frame.vertical,
		ports: state.ports,
	});
	if (scoped) proposal = scopePortAllocation(proposal, structure);
	placeWithRoutingPorts(workspace, proposal, structure, state.reservation);
	let ports = alignJunctionPorts({
		...input,
		vertical: workspace.frame.vertical,
		ports: state.ports,
	});
	if (scoped) ports = scopePortAllocation(ports, structure);
	const plan = planLayeredRouting(input, ports);
	const reservation = reservedPlan(plan, state.base, scoped);
	placeWithRoutingPorts(workspace, ports, structure, reservation);
	const fits = [...ports.sizes].every(([id, size]) => {
		const placed = proposal.sizes.get(id);
		return placed?.width === size.width && placed.height === size.height;
	});
	if (fits && improvesRoutes(originalPaths, materializeLayers(input, plan)))
		return { ports, plan, reservation, base: state.base };
	placeWithRoutingPorts(workspace, state.ports, structure, state.reservation);
	return state;
}
export function reserveLayeredRouting(
	workspace: LayoutRoutingWorkspace,
	layers: RoutingLayers,
	routingStructure: LayoutStructure = workspace.structure,
	baseReservation: RoutingReservation = { gaps: new Map() },
): LayeredRoutingResult | undefined {
	const { measurements, placement, frame } = workspace;
	const structure = routingStructure;
	if (structure.junctionIds.size === 0 && structure.maximumRank <= 1) return undefined;
	const skipsOrdinaryRows =
		structure.junctionIds.size === 0 &&
		structure.graph.relations.some(({ relation }) => {
			const sourceRank = defined(structure.ranks.byEndpointId.get(relation.from));
			const targetRank = defined(structure.ranks.byEndpointId.get(relation.to));
			return sourceRank > targetRank + 1;
		});
	if (structure.junctionIds.size === 0 && !skipsOrdinaryRows) return undefined;
	const alignment = alignBypassedChains(
		bypassedChains(structure.graph, structure.ranks.byEndpointId),
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
		// Relation components: a block gathers several of them without connecting their routes.
		componentByEndpointId: new Map(
			weaklyConnectedComponents(workspace.structure.graph).flatMap((ids, index) =>
				ids.map((id) => [id, index] as const),
			),
		),
	};
	const allocated = allocateLayerPorts({
		forceChannels: routingStructure !== workspace.structure,
		...input,
		space: directRoutingSpace({
			layers,
			bounds: placement.bounds,
			frame,
			junctionIds: structure.junctionIds,
			enclosingGroups: new Set(structure.hierarchy?.membersById.keys()),
		}),
	});
	if (allocated === undefined) return undefined;
	const scoped = routingStructure !== workspace.structure;
	let ports = allocated;
	if (scoped) ports = scopePortAllocation(ports, structure);
	if (routingStructure === workspace.structure) placement.transverseCenters = alignment?.centers;
	else if (alignment !== undefined) {
		const centers = new Map(placement.transverseCenters ?? []);
		for (const [id, center] of alignment.centers) centers.set(id, center);
		placement.transverseCenters = centers;
	}
	ports = withChainAlignment(ports, alignment);
	if (routingStructure !== workspace.structure) ports = scopePortAllocation(ports, structure);
	let initialReservation: RoutingReservation = baseReservation;
	if (!scoped) initialReservation = { gaps: new Map<number, number>() };
	placeWithRoutingPorts(workspace, ports, structure, initialReservation);
	let plan = planLayeredRouting(input, ports);
	let reservation = reservedPlan(plan, baseReservation, scoped);
	placeWithRoutingPorts(workspace, ports, structure, reservation);
	if (structure.junctionIds.size > 0) {
		({ ports, plan, reservation } = alignLayeredJunctions(workspace, structure, input, {
			ports,
			plan,
			reservation,
			base: baseReservation,
		}));
	}
	const routing: NodeRouting = {
		ports,
		gaps: reservation.gaps,
		ranks: structure.ranks.byEndpointId,
		corridors: [],
		railCounts: new Map(),
	};
	workspace.routing = routing;
	return { materialize: () => materializeLayers(input, plan), reservation, routing };
}
