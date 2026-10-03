import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { LayoutFrame } from '../geometry/layout-frame';
import { mainSize, transverseSize, transverseStart } from '../geometry/layout-frame';
import {
	BASE_RANK_GAP,
	GROUP_FRAME_CLEARANCE,
	JUNCTION_CHANNEL_GAP,
	RAIL_SPACING,
} from '../layout-settings';
import type { Bounds, Point, RoutingLayers, Size } from '../layout-types';
import { routeChannel } from './channel-routing';
import type { ChannelRouting, ChannelRun } from './channel-types';
import { channelPoints } from './materialize-node-routes';
import { type PortAllocation, sharedSourcePorts, sharedTargetPorts } from './port-allocation';
import { layerExtent, type LayerLink, layerLinks, linkCoordinate } from './routing-layers';
import { componentRoutingSpaces, type RoutingSpace } from './routing-space';

interface LayerChannel extends ChannelRouting {
	readonly layer: number;
	readonly links: readonly LayerLink[];
}
export interface LayerPlan {
	readonly layers: RoutingLayers;
	readonly enclosingGroups: ReadonlySet<string>;
	readonly channels: readonly LayerChannel[];
	readonly ports: PortAllocation;
	readonly gaps: ReadonlyMap<number, number>;
	readonly channelGaps: ReadonlyMap<number, readonly number[]>;
	readonly componentByEndpointId: ReadonlyMap<string, number>;
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

interface OuterArrival {
	readonly passage: number;
	readonly run: ChannelRun;
}

function runConflictsOnRail(
	run: ChannelRun,
	rail: number,
	runs: ReadonlySet<ChannelRun | undefined>,
): boolean {
	for (const other of runs) {
		if (other === undefined || other === run) continue;
		if (other.rail !== rail) continue;
		const before = run.end + RAIL_SPACING / 2 < other.start;
		const after = other.end + RAIL_SPACING / 2 < run.start;
		if (!before && !after) return true;
	}
	return false;
}

function outerArrivals(
	channel: ChannelRouting,
	links: readonly LayerLink[],
	input: LayerInput,
): ReadonlyMap<string, OuterArrival[]> {
	const byTarget = new Map<string, OuterArrival[]>();
	for (const [index, link] of links.entries()) {
		if (link.passage === undefined) continue;
		if (link.sourceLayer <= link.targetLayer + 1) continue;
		const source = input.graph.endpointsById.get(link.relation.from);
		const target = input.graph.endpointsById.get(link.relation.to);
		if (source?.kind !== EndpointKind.Node || target?.kind !== EndpointKind.Node) continue;
		const targetBox = defined(input.bounds.get(link.relation.to));
		const end =
			transverseStart(targetBox, input.frame.vertical) +
			transverseSize(targetBox, input.frame.vertical);
		if (link.passage < end + RAIL_SPACING) continue;
		const run = defined(channel.wires[index]).last;
		if (run === undefined) continue;
		const arrivals = byTarget.get(link.relation.to) ?? [];
		arrivals.push({ passage: link.passage, run });
		byTarget.set(link.relation.to, arrivals);
	}
	return byTarget;
}

/** Nested long arrivals need increasing tracks: a farther column must cross behind an inner one. */
function reserveOuterArrivalRails(
	channel: ChannelRouting,
	byTarget: ReadonlyMap<string, OuterArrival[]>,
): ChannelRouting {
	let railCount = channel.railCount;
	let trackByRunKey: Map<number, number> | undefined;
	let runs: ReadonlySet<ChannelRun | undefined> | undefined;
	for (const arrivals of byTarget.values()) {
		if (arrivals.length < 2) continue;
		runs ??= new Set(channel.wires.flatMap(({ first, last }) => [first, last]));
		arrivals.sort((a, b) => a.passage - b.passage);
		let previous = -1;
		for (const { run } of arrivals) {
			let rail = Math.max(previous + 1, run.rail);
			while (runConflictsOnRail(run, rail, runs)) rail += 1;
			if (run.rail !== rail) {
				trackByRunKey ??= new Map(channel.trackByRunKey);
				trackByRunKey.set(run.key, rail);
				run.rail = rail;
			}
			previous = rail;
			railCount = Math.max(railCount, rail + 1);
		}
	}
	if (trackByRunKey === undefined) return channel;
	return { ...channel, edge: { ...channel.edge, capacity: railCount }, trackByRunKey, railCount };
}

function channelsFor(input: LayerInput, ports: PortAllocation): readonly LayerChannel[] {
	const { graph, layers, bounds, frame } = input;
	const links = layerLinks(graph, layers, bounds, {
		vertical: frame.vertical,
		componentByEndpointId: input.componentByEndpointId,
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
	// Preserve relation order in each channel while visiting only the layers a link crosses.
	const linksByChannel = Array.from({ length: layers.rows.length - 1 }, () => [] as LayerLink[]);
	for (const link of links)
		for (let layer = link.targetLayer; layer < link.sourceLayer; layer += 1)
			defined(linksByChannel[layer]).push(link);
	const channels: LayerChannel[] = [];
	for (let layer = 0; layer < layers.rows.length - 1; layer += 1) {
		const crossing = defined(linksByChannel[layer]);
		const geometry = { bounds, vertical: frame.vertical };
		const endpoints = crossing.map((link) => {
			let sharedTarget: string | undefined;
			let sharedSource: string | undefined;
			if (link.sourceLayer === layer + 1) sharedSource = sourcePorts.get(link.relation.id);
			sharedTarget = targetPorts.get(link.relation.id);
			if (input.junctionIds.has(link.relation.to)) sharedTarget = link.relation.to;
			return {
				id: link.relation.id,
				sourceEndpoint: graph.endpointsById.get(link.relation.from),
				targetEndpoint: graph.endpointsById.get(link.relation.to),
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
		const channel = routeChannel(endpoints, `@root/channel/layer-${layer}`);
		const routed = reserveOuterArrivalRails(channel, outerArrivals(channel, crossing, input));
		channels.push({ layer, links: crossing, ...routed });
	}
	return channels;
}

/** Reserve shell thickness as well as a free channel wide enough for every rail. */
function groupChannelGap(
	input: LayerInput,
	channel: LayerChannel,
	spaces: ReadonlyMap<number, RoutingSpace>,
): number {
	const before = layerExtent(defined(input.layers.rows[channel.layer]), input.bounds, input.frame);
	const after = layerExtent(
		defined(input.layers.rows[channel.layer + 1]),
		input.bounds,
		input.frame,
	);
	if (!Number.isFinite(before.end) || !Number.isFinite(after.start)) return 0;
	let shells = 0;
	for (const { relation } of channel.links) {
		const owner = defined(input.componentByEndpointId.get(relation.from));
		const { extents } = defined(spaces.get(owner));
		const freeBefore = defined(extents[channel.layer]);
		const freeAfter = defined(extents[channel.layer + 1]);
		const shiftedAfter = freeBefore.end - before.end + after.start;
		shells = Math.max(shells, shiftedAfter - freeAfter.start);
	}
	if (shells <= 0) return 0;
	const rails = Math.max(0, channel.railCount - 1) * RAIL_SPACING;
	return shells + GROUP_FRAME_CLEARANCE + rails;
}

export function planLayeredRouting(input: LayerInput, ports: PortAllocation): LayerPlan {
	const { layers } = input;
	const channels = channelsFor(input, ports);
	const enclosingGroups = new Set<string>();
	for (const { entity } of input.graph.endpointsById.values())
		if (entity.groupId !== undefined) enclosingGroups.add(entity.groupId);
	const spaces = componentRoutingSpaces({ ...input, enclosingGroups }, input.componentByEndpointId);
	const channelGaps = new Map<number, number[]>();
	const gaps = new Map<number, number>();
	for (const channel of channels) {
		const interval = defined(layers.intervals[channel.layer]);
		const bordersJunction = [channel.layer, channel.layer + 1].some((layer) =>
			defined(layers.rows[layer]).some((id) => input.junctionIds.has(id)),
		);
		let base = BASE_RANK_GAP;
		if (bordersJunction) base = JUNCTION_CHANNEL_GAP;
		const gap = Math.max(
			base + Math.max(0, channel.railCount - 1) * RAIL_SPACING,
			groupChannelGap(input, channel, spaces),
		);
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
	return {
		layers,
		enclosingGroups,
		channels,
		ports,
		gaps,
		channelGaps,
		componentByEndpointId: input.componentByEndpointId,
	};
}

export function materializeLayers(
	input: LayerGeometry,
	plan: LayerPlan,
): ReadonlyMap<string, readonly Point[]> {
	const { bounds, frame } = input;
	const spaces = componentRoutingSpaces(
		{
			...input,
			layers: plan.layers,
			enclosingGroups: plan.enclosingGroups,
		},
		plan.componentByEndpointId,
	);
	const frames: Bounds[] = [];
	for (const id of plan.enclosingGroups) {
		const box = bounds.get(id);
		if (box !== undefined) frames.push(box);
	}
	let sign = 1;
	if (!frame.forward) sign = -1;
	const paths = new Map<string, Point[]>();
	for (const channel of plan.channels.toReversed()) {
		for (const [index, wire] of channel.wires.entries()) {
			const link = defined(channel.links[index]);
			const { extents } = defined(
				spaces.get(defined(plan.componentByEndpointId.get(link.relation.from))),
			);
			const before = defined(extents[channel.layer]);
			const after = defined(extents[channel.layer + 1]);
			const center = (before.end + after.start) / 2;
			const halfSpan = ((channel.railCount - 1) * RAIL_SPACING) / 2;
			const geometry = {
				vertical: frame.vertical,
				railStart: (center + halfSpan) * sign,
				railStep: -sign * RAIL_SPACING,
				frames,
			};
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
