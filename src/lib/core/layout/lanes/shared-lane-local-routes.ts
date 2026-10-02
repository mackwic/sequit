import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { Point } from '../layout-types';
import { routeChannel } from '../routing/channel-routing';
import type { ChannelEndpoint, ChannelWire } from '../routing/channel-types';
import { boundaryKey, boundaryTrack, type PlacedBoundaries } from './shared-lane-boundaries';
import { facePortOffset } from './shared-lane-face-ports';
import type { LaneSide, SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import { incidenceKey, PortRole, type SharedLanePorts } from './shared-lane-ports';
import type { CrossExtent, LogicalBox } from './shared-lane-types';

/**
 * The corridors of a parallel frame: a strip along one edge of each lane, beside its bands, that the
 * local routes crossing more than one row boundary follow without meeting a box.
 */
export interface LocalCorridors {
	/** The edge of each lane its corridor runs along. */
	readonly sides: readonly LaneSide[];
	/** The cross width of each lane corridor. */
	readonly widths: readonly number[];
	/** The corridor track of every local route spanning several rows; track 0 is nearest the edge. */
	readonly trackByPlan: ReadonlyMap<string, number>;
}

/** Where the local routes of a frame turn, once the cross axis is placed. */
export interface LocalChannels {
	/** The local rails of each lane boundary, keyed by `boundaryKey`. */
	readonly rails: ReadonlyMap<string, number>;
	/** The port, on its longitudinal face, of every local incidence, by `incidenceKey`. */
	readonly portCross: ReadonlyMap<string, number>;
	/** The routed wires of each local plan: one per row boundary it turns in. */
	readonly wiresByPlan: ReadonlyMap<string, readonly LocalWire[]>;
}

interface LocalWire {
	readonly laneIndex: number;
	readonly boundaryIndex: number;
	readonly wire: ChannelWire;
}

/** The cross placement local routes read: the lanes and the cross extent of every box. */
export interface LocalCrossPlacement {
	readonly laneStarts: readonly number[];
	readonly laneWidths: readonly number[];
	readonly boxes: ReadonlyMap<string, CrossExtent>;
}

function span(input: SharedLaneInput, plan: SharedLanePlan): number {
	const source = defined(input.endpoints.get(plan.from));
	const target = defined(input.endpoints.get(plan.to));
	return source.row - target.row;
}

/**
 * The first lane keeps its corridor on its outer edge, away from the gutter its lane crossings use;
 * every other lane keeps it on its far edge. A corridor nests its routes: the longest span runs
 * nearest the lane edge, so a shorter one turns into its track without crossing it.
 */
export function planLocalCorridors(input: SharedLaneInput): LocalCorridors {
	const order = new Map(input.plans.map(({ id }, index) => [id, index]));
	const spanning = input.plans
		.filter((plan) => plan.local && span(input, plan) > 1)
		.toSorted(
			(a, b) =>
				span(input, b) - span(input, a) || defined(order.get(a.id)) - defined(order.get(b.id)),
		);
	const counts = input.laneIds.map(() => 0);
	const trackByPlan = new Map<string, number>();
	for (const plan of spanning) {
		const lane = plan.sourceLaneIndex;
		trackByPlan.set(plan.id, defined(counts[lane]));
		counts[lane] = defined(counts[lane]) + 1;
	}
	const sides = input.laneIds.map((_, lane): LaneSide => {
		if (lane === 0) return -1;
		return 1;
	});
	return { sides, widths: counts.map((count) => count * RAIL_SPACING), trackByPlan };
}

function corridorCross(
	corridors: LocalCorridors,
	placement: LocalCrossPlacement,
	plan: SharedLanePlan,
): number {
	const lane = plan.sourceLaneIndex;
	const offset = (defined(corridors.trackByPlan.get(plan.id)) + 0.5) * RAIL_SPACING;
	const start = defined(placement.laneStarts[lane]);
	if (corridors.sides[lane] === -1) return start + offset;
	return start + defined(placement.laneWidths[lane]) - offset;
}

function boxCenter(placement: LocalCrossPlacement, endpointId: string): number {
	const box = defined(placement.boxes.get(endpointId));
	return box.cross + box.crossSize / 2;
}

/** The cross coordinate each local incidence turns toward once it reaches its first boundary. */
function turnCross(
	input: SharedLaneInput,
	corridors: LocalCorridors,
	placement: LocalCrossPlacement,
): ReadonlyMap<string, number> {
	const turns = new Map<string, number>();
	for (const plan of input.plans) {
		if (!plan.local) continue;
		let toward = boxCenter(placement, plan.to);
		let from = boxCenter(placement, plan.from);
		if (corridors.trackByPlan.has(plan.id)) {
			toward = corridorCross(corridors, placement, plan);
			from = toward;
		}
		turns.set(incidenceKey(plan.id, PortRole.Source), toward);
		turns.set(incidenceKey(plan.id, PortRole.Target), from);
	}
	return turns;
}

/** Each face orders its ports like the places they turn toward, so its stubs do not cross. */
function localPortCross(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	corridors: LocalCorridors,
	placement: LocalCrossPlacement,
): ReadonlyMap<string, number> {
	const turns = turnCross(input, corridors, placement);
	const portCross = new Map<string, number>();
	for (const face of ports.localFaces) {
		const keys = face.incidences
			.map(({ relationId, role }) => incidenceKey(relationId, role))
			.toSorted(
				(a, b) => defined(turns.get(a)) - defined(turns.get(b)) || compareCanonicalStrings(a, b),
			);
		const center = boxCenter(placement, face.endpointId);
		for (const [index, key] of keys.entries())
			portCross.set(key, center + facePortOffset(index, keys.length, face.reserved));
	}
	return portCross;
}

interface ChannelDemand {
	readonly laneIndex: number;
	readonly boundaryIndex: number;
	readonly endpoints: { readonly plan: string; readonly endpoint: ChannelEndpoint }[];
}

function addWire(
	channels: Map<string, ChannelDemand>,
	plan: SharedLanePlan,
	boundaryIndex: number,
	columns: { readonly source: number; readonly target: number },
): void {
	const laneIndex = plan.sourceLaneIndex;
	const key = boundaryKey(laneIndex, boundaryIndex);
	const channel = channels.get(key) ?? { laneIndex, boundaryIndex, endpoints: [] };
	channel.endpoints.push({ plan: plan.id, endpoint: { id: plan.id, ...columns } });
	channels.set(key, channel);
}

/**
 * Every local route turns in the boundary right before its source row and, when it spans several
 * rows, in the boundary right after its target row, where it leaves its corridor. Each lane
 * boundary is one channel; the channel router orders its rails.
 */
export function planLocalChannels(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	corridors: LocalCorridors,
	placement: LocalCrossPlacement,
): LocalChannels {
	const portCross = localPortCross(input, ports, corridors, placement);
	const channels = new Map<string, ChannelDemand>();
	for (const plan of input.plans) {
		if (!plan.local) continue;
		const source = defined(portCross.get(incidenceKey(plan.id, PortRole.Source)));
		const target = defined(portCross.get(incidenceKey(plan.id, PortRole.Target)));
		const sourceRow = defined(input.endpoints.get(plan.from)).row;
		if (!corridors.trackByPlan.has(plan.id)) {
			addWire(channels, plan, sourceRow, { source, target });
			continue;
		}
		const corridor = corridorCross(corridors, placement, plan);
		const targetRow = defined(input.endpoints.get(plan.to)).row;
		addWire(channels, plan, sourceRow, { source, target: corridor });
		addWire(channels, plan, targetRow + 1, { source: corridor, target });
	}
	const rails = new Map<string, number>();
	const wiresByPlan = new Map<string, LocalWire[]>();
	for (const [key, channel] of channels) {
		const routing = routeChannel(channel.endpoints.map(({ endpoint }) => endpoint));
		if (routing.railCount > 0) rails.set(key, routing.railCount);
		for (const [index, { plan }] of channel.endpoints.entries()) {
			const wires = wiresByPlan.get(plan) ?? [];
			const { laneIndex, boundaryIndex } = channel;
			wires.push({ laneIndex, boundaryIndex, wire: defined(routing.wires[index]) });
			wiresByPlan.set(plan, wires);
		}
	}
	return { rails, portCross, wiresByPlan };
}

/** The points of one wire between its two columns, on the rails its boundary grants it. */
function wirePoints(boundaries: PlacedBoundaries, local: LocalWire): readonly Point[] {
	const { wire, laneIndex, boundaryIndex } = local;
	if (wire.first === undefined) return [];
	const use = defined(boundaries.uses.get(boundaryKey(laneIndex, boundaryIndex)));
	// Rail 0 runs nearest the departure side, the later row.
	const rail = (index: number) =>
		boundaryTrack(boundaries, laneIndex, boundaryIndex, use.earlier + use.rails - 1 - index);
	const first = rail(wire.first.rail);
	const last = rail(defined(wire.last).rail);
	if (wire.middle === undefined)
		return [
			{ x: wire.source, y: first },
			{ x: wire.target, y: last },
		];
	return [
		{ x: wire.source, y: first },
		{ x: wire.middle, y: first },
		{ x: wire.middle, y: last },
		{ x: wire.target, y: last },
	];
}

/** The logical points of every local route: its source port, its turns, its target port. */
export function materializeLocalRoutes(
	input: SharedLaneInput,
	channels: LocalChannels,
	boxes: ReadonlyMap<string, LogicalBox>,
	boundaries: PlacedBoundaries,
): ReadonlyMap<string, readonly Point[]> {
	const routes = new Map<string, readonly Point[]>();
	for (const plan of input.plans) {
		if (!plan.local) continue;
		const source = defined(boxes.get(plan.from));
		const target = defined(boxes.get(plan.to));
		const wires = defined(channels.wiresByPlan.get(plan.id)).toSorted(
			(a, b) => b.boundaryIndex - a.boundaryIndex,
		);
		routes.set(plan.id, [
			{
				x: defined(channels.portCross.get(incidenceKey(plan.id, PortRole.Source))),
				y: source.longitudinal,
			},
			...wires.flatMap((wire) => wirePoints(boundaries, wire)),
			{
				x: defined(channels.portCross.get(incidenceKey(plan.id, PortRole.Target))),
				y: target.longitudinal + target.longSize,
			},
		]);
	}
	return routes;
}
