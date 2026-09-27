import { defined, EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { LayoutFrame } from '../geometry/layout-frame';
import { mainSize, transverseSize, transverseStart } from '../geometry/layout-frame';
import { BASE_RANK_GAP, JUNCTION_CHANNEL_GAP, RAIL_SPACING } from '../layout-settings';
import type { Bounds, Point, RoutingLayers, Size } from '../layout-types';
import { routeChannel } from './channel-routing';
import type { ChannelRouting, ChannelRun, ChannelWire } from './channel-types';
import { channelPoints } from './materialize-node-routes';
import { type PortAllocation, sharedSourcePorts, sharedTargetPorts } from './port-allocation';
import { layerExtent, type LayerLink, layerLinks, linkCoordinate } from './routing-layers';

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
	let runs: ReadonlySet<ChannelRun | undefined> | undefined;
	for (const arrivals of byTarget.values()) {
		if (arrivals.length < 2) continue;
		runs ??= new Set(channel.wires.flatMap(({ first, last }) => [first, last]));
		arrivals.sort((a, b) => a.passage - b.passage);
		let previous = -1;
		for (const { run } of arrivals) {
			let rail = Math.max(previous + 1, run.rail);
			while (runConflictsOnRail(run, rail, runs)) rail += 1;
			run.rail = rail;
			previous = rail;
			railCount = Math.max(railCount, rail + 1);
		}
	}
	if (railCount === channel.railCount) return channel;
	return { ...channel, railCount };
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
		const channel = routeChannel(endpoints);
		const routed = reserveOuterArrivalRails(channel, outerArrivals(channel, crossing, input));
		channels.push({ layer, links: crossing, ...routed });
	}
	return channels;
}

function intersectsGroupSide(from: number, to: number, start: number, end: number): boolean {
	return Math.min(from, to) < end && Math.max(from, to) > start;
}

function foreignWireGap(
	wire: ChannelWire,
	side: { readonly start: number; readonly end: number },
	base: number,
	railStep: number,
): number {
	if (wire.first === undefined || wire.last === undefined) return 0;
	let gap = 0;
	const middle = wire.middle ?? wire.target;
	if (intersectsGroupSide(wire.source, middle, side.start, side.end))
		gap = Math.max(gap, base + railStep * wire.first.rail);
	const lastStart = wire.middle ?? wire.source;
	if (intersectsGroupSide(lastStart, wire.target, side.start, side.end))
		gap = Math.max(gap, base + railStep * wire.last.rail);
	return 2 * gap;
}

function groupShellGap(
	input: LayerInput,
	channel: LayerChannel,
	groupId: string,
	space: { readonly beforeEnd: number; readonly afterStart: number; readonly halfSpan: number },
): number {
	const box = defined(input.bounds.get(groupId));
	let mainStart = box.x;
	if (input.frame.vertical) mainStart = box.y;
	const mainLength = mainSize(box, input.frame.vertical);
	let start = mainStart;
	if (!input.frame.forward) start = -mainStart - mainLength;
	const end = start + mainLength;
	let base: number;
	let railStep: number;
	const startsInGap = start > space.beforeEnd && start < space.afterStart;
	const endsInGap = end > space.beforeEnd && end < space.afterStart;
	if (startsInGap && end >= space.afterStart) {
		base = space.afterStart - start + space.halfSpan;
		railStep = -RAIL_SPACING;
	} else if (endsInGap && start <= space.beforeEnd) {
		base = end - space.beforeEnd - space.halfSpan;
		railStep = RAIL_SPACING;
	} else return 0;
	const sideStart = transverseStart(box, input.frame.vertical);
	const side = { start: sideStart, end: sideStart + transverseSize(box, input.frame.vertical) };
	let gap = 0;
	for (const [index, wire] of channel.wires.entries()) {
		const relation = defined(channel.links[index]).relation;
		if (ownsGroup(input.graph, relation.from, groupId)) continue;
		if (ownsGroup(input.graph, relation.to, groupId)) continue;
		gap = Math.max(gap, foreignWireGap(wire, side, base, railStep));
	}
	return gap;
}

/** Keep foreign channel rails outside the shell of a group anchored at either adjacent row. */
function groupChannelGap(input: LayerInput, channel: LayerChannel): number {
	if (input.graph.document.groups.length === 0) return 0;
	const before = layerExtent(defined(input.layers.rows[channel.layer]), input.bounds, input.frame);
	const after = layerExtent(
		defined(input.layers.rows[channel.layer + 1]),
		input.bounds,
		input.frame,
	);
	const space = {
		beforeEnd: before.end,
		afterStart: after.start,
		halfSpan: ((channel.railCount - 1) * RAIL_SPACING) / 2,
	};
	let gap = 0;
	for (const group of input.graph.document.groups)
		gap = Math.max(gap, groupShellGap(input, channel, group.id, space));
	return gap;
}

function ownsGroup(graph: LogicGraph, endpointId: string, groupId: string): boolean {
	let parentId = graph.endpointsById.get(endpointId)?.entity.groupId;
	while (parentId !== undefined) {
		if (parentId === groupId) return true;
		parentId = graph.endpointsById.get(parentId)?.entity.groupId;
	}
	return false;
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
		const gap = Math.max(
			base + Math.max(0, channel.railCount - 1) * RAIL_SPACING,
			groupChannelGap(input, channel),
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
