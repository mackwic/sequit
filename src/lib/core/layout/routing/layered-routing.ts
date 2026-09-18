import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { LayoutFrame } from '../geometry/layout-frame';
import { mainSize } from '../geometry/layout-frame';
import { BASE_RANK_GAP, JUNCTION_CHANNEL_GAP, RAIL_SPACING } from '../layout-settings';
import type { Bounds, Point, RoutingLayers, Size } from '../layout-types';
import { routeChannel } from './channel-routing';
import type { ChannelRouting } from './channel-types';
import { channelPoints } from './materialize-node-routes';
import {
	allocatePorts,
	type PortAllocation,
	sharedSourcePorts,
	sharedTargetPorts,
} from './port-allocation';
import { crossingCorridors } from './routing-corridors';
import { layerExtent, type LayerLink, layerLinks, linkCoordinate } from './routing-layers';
import { directRouteFitsSpace, type DirectRoutingSpace } from './routing-space';

interface LayerChannel extends ChannelRouting {
	readonly layer: number;
	readonly links: readonly LayerLink[];
}
export interface LayerPlan {
	readonly layers: RoutingLayers;
	readonly channels: readonly LayerChannel[];
	readonly ports: PortAllocation;
	readonly gaps: ReadonlyMap<number, number>;
	readonly channelGaps: ReadonlyMap<number, readonly number[]>;
}

interface LayerGeometry {
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly frame: LayoutFrame;
}
interface LayerInput extends LayerGeometry {
	readonly graph: LogicGraph;
	readonly layers: RoutingLayers;
	readonly junctionIds: ReadonlySet<string>;
	readonly ranks: ReadonlyMap<string, number>;
	readonly sizes: ReadonlyMap<string, Size>;
	readonly componentByEndpointId: ReadonlyMap<string, number>;
}

interface ReservationInput extends LayerInput {
	readonly space: DirectRoutingSpace;
}

function channelsFor(input: LayerInput, ports: PortAllocation): readonly LayerChannel[] {
	const { graph, layers, bounds, frame } = input;
	const links = layerLinks(graph, layers, bounds, {
		vertical: frame.vertical,
		sourceOffsets: ports.sourceOffsets,
		targetOffsets: ports.targetOffsets,
	});
	const sourcePorts = sharedSourcePorts(
		links.map(({ relation }) => relation),
		ports.sourceOffsets,
	);
	const targetPorts = sharedTargetPorts(
		links.map(({ relation }) => relation),
		ports.targetOffsets,
	);
	const channels: LayerChannel[] = [];
	for (let layer = 0; layer < layers.rows.length - 1; layer += 1) {
		const crossing = links.filter((link) => link.targetLayer <= layer && link.sourceLayer > layer);
		const geometry = { bounds, vertical: frame.vertical };
		const endpoints = crossing.map((link) => {
			let sharedTarget: string | undefined;
			let sharedSource: string | undefined;
			if (link.sourceLayer === layer + 1) sharedSource = sourcePorts.get(link.relation.id);
			sharedTarget = targetPorts.get(link.relation.id);
			if (input.junctionIds.has(link.relation.to)) sharedTarget = link.relation.to;
			return {
				id: link.relation.id,
				sharedTarget,
				sharedSource,
				source: linkCoordinate(link, true, layer + 1, {
					...geometry,
					offsets: ports.sourceOffsets,
				}),
				target: linkCoordinate(link, false, layer, {
					...geometry,
					offsets: ports.targetOffsets,
				}),
			};
		});
		channels.push({ layer, links: crossing, ...routeChannel(endpoints) });
	}
	return channels;
}

export function planLayeredRouting(input: LayerInput, ports: PortAllocation): LayerPlan {
	const { layers } = input;
	const channels = channelsFor(input, ports);
	const channelGaps = new Map<number, number[]>();
	const gaps = new Map<number, number>();
	for (const channel of channels) {
		const interval = defined(layers.intervals[channel.layer]);
		const bordersJunction = [channel.layer, channel.layer + 1].some((layer) =>
			defined(layers.rows[layer]).some((id) => input.junctionIds.has(id)),
		);
		let base = BASE_RANK_GAP;
		if (bordersJunction) base = JUNCTION_CHANNEL_GAP;
		const gap = base + Math.max(0, channel.railCount - 1) * RAIL_SPACING;
		const slots = channelGaps.get(interval) ?? [];
		slots.push(gap);
		channelGaps.set(interval, slots);
		gaps.set(interval, (gaps.get(interval) ?? 0) + gap);
	}
	for (const [layer, row] of layers.rows.entries()) {
		if (!row.some((id) => input.junctionIds.has(id))) continue;
		const thickness = Math.max(
			...row.map((id) => mainSize(defined(input.sizes.get(id)), input.frame.vertical)),
		);
		const interval = defined(layers.intervals[layer]);
		gaps.set(interval, (gaps.get(interval) ?? 0) + thickness);
	}
	return { layers, channels, ports, gaps, channelGaps };
}

export function materializeLayers(
	input: LayerGeometry,
	plan: LayerPlan,
): ReadonlyMap<string, readonly Point[]> {
	const { bounds, frame } = input;
	const extents = plan.layers.rows.map((row) => layerExtent(row, bounds, frame));
	let sign = 1;
	if (!frame.forward) sign = -1;
	const paths = new Map<string, Point[]>();
	for (const channel of plan.channels.toReversed()) {
		const before = defined(extents[channel.layer]);
		const after = defined(extents[channel.layer + 1]);
		const center = (before.end + after.start) / 2;
		const halfSpan = ((channel.railCount - 1) * RAIL_SPACING) / 2;
		const geometry = {
			vertical: frame.vertical,
			railStart: (center + halfSpan) * sign,
			railStep: -sign * RAIL_SPACING,
		};
		for (const [index, wire] of channel.wires.entries()) {
			const link = defined(channel.links[index]);
			let departure = after.start;
			let arrival = before.end;
			if (link.sourceLayer === channel.layer + 1)
				departure = layerExtent([link.relation.from], bounds, frame).start;
			if (link.targetLayer === channel.layer)
				arrival = layerExtent([link.relation.to], bounds, frame).end;
			const points = paths.get(wire.id) ?? [];
			points.push(...channelPoints(wire, departure * sign, arrival * sign, geometry));
			paths.set(wire.id, points);
		}
	}
	return paths;
}

/** Reserve faces before placement; channels are planned from the resulting transverse positions. */
export function allocateLayerPorts(input: ReservationInput): PortAllocation | undefined {
	const { graph, layers, bounds, frame, junctionIds, sizes } = input;
	const crossings = crossingCorridors({
		graph,
		ranks: layers.byId,
		bounds,
		vertical: frame.vertical,
		includeJunctions: true,
	});
	const passages = layerLinks(graph, layers, bounds, {
		vertical: frame.vertical,
	});
	const direct = passages.every(({ relation, sourceLayer, targetLayer }) => {
		if (sourceLayer === targetLayer + 1) return true;
		const sourceRank = defined(input.ranks.get(relation.from));
		const targetRank = defined(input.ranks.get(relation.to));
		if (sourceRank > targetRank + 1) return false;
		if (junctionIds.has(relation.from) || junctionIds.has(relation.to)) return false;
		return directRouteFitsSpace(input.space, relation.from, relation.to);
	});
	if (crossings.length === 0 && direct) {
		// A later ordinary reservation would move the rails and invalidate the direct passages.
		const ordinaryCrossings = crossingCorridors({
			graph,
			ranks: input.ranks,
			bounds,
			vertical: frame.vertical,
		});
		if (ordinaryCrossings.length === 0) return undefined;
	}
	const routedComponents = new Set<number>();
	for (const id of junctionIds) routedComponents.add(defined(input.componentByEndpointId.get(id)));
	for (const { links } of crossings)
		for (const { relation } of links)
			routedComponents.add(defined(input.componentByEndpointId.get(relation.from)));
	for (const { relation } of passages) {
		const sourceRank = defined(input.ranks.get(relation.from));
		const targetRank = defined(input.ranks.get(relation.to));
		if (sourceRank > targetRank + 1)
			routedComponents.add(defined(input.componentByEndpointId.get(relation.from)));
	}
	const links = passages.map((link) => {
		const geometry = {
			bounds,
			vertical: frame.vertical,
			offsets: new Map<string, number>(),
		};
		// Order each face by the opposite side of its adjacent channel, including long passages.
		return {
			relation: link.relation,
			source: linkCoordinate(link, true, link.targetLayer + 1, geometry),
			target: linkCoordinate(link, false, link.sourceLayer - 1, geometry),
		};
	});
	const sharedTargets = new Set(junctionIds);
	for (const { relation } of passages)
		if (!routedComponents.has(defined(input.componentByEndpointId.get(relation.to))))
			sharedTargets.add(relation.to);
	return allocatePorts({
		corridors: [{ rank: 0, links }],
		sizes,
		bounds,
		graph,
		vertical: frame.vertical,
		sharedSources: junctionIds,
		sharedTargets,
	});
}
