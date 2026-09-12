import { defined, LayoutDirection } from '../document/logic-document';
import { type ChannelRouting, type ChannelWire, routeChannel } from './channel-routing';
import type { Bounds, Point } from './layout-types';
import type { QuayAllocation } from './quay-allocation';
import { crossCenter, type RoutingCorridor } from './routing-corridors';

const RAIL_SPACING = 24;
export const BASE_GAP = 72;
interface PlannedCorridor extends ChannelRouting {
	readonly corridor: RoutingCorridor;
}
export interface NodeRouting {
	readonly quays: QuayAllocation;
	readonly ranks: ReadonlyMap<string, number>;
	readonly corridors: readonly PlannedCorridor[];
	readonly gaps: ReadonlyMap<number, number>;
	readonly railCounts: ReadonlyMap<number, number>;
}

export function planNodeRouting(input: {
	readonly corridors: readonly RoutingCorridor[];
	readonly quays: QuayAllocation;
	readonly ranks: ReadonlyMap<string, number>;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
}): NodeRouting {
	const gaps = new Map<number, number>();
	const railCounts = new Map<number, number>();
	const corridors = input.corridors.map((corridor) => {
		const channel = routeChannel(
			corridor.links.map(({ relation }) => ({
				id: relation.id,
				source:
					crossCenter(defined(input.bounds.get(relation.from)), input.vertical) +
					defined(input.quays.sourceOffsets.get(relation.id)),
				target:
					crossCenter(defined(input.bounds.get(relation.to)), input.vertical) +
					defined(input.quays.targetOffsets.get(relation.id)),
			})),
		);
		const count = Math.max(railCounts.get(corridor.rank) ?? 0, channel.railCount);
		railCounts.set(corridor.rank, count);
		gaps.set(corridor.rank, BASE_GAP + Math.max(0, count - 1) * RAIL_SPACING);
		return { ...channel, corridor };
	});
	return { corridors, gaps, railCounts, quays: input.quays, ranks: input.ranks };
}

function at(cross: number, primary: number, vertical: boolean): Point {
	if (vertical) return { x: cross, y: primary };
	return { x: primary, y: cross };
}

interface ChannelGeometry {
	readonly vertical: boolean;
	readonly railStart: number;
	readonly railStep: number;
}

function pointsFor(
	wire: ChannelWire,
	departure: number,
	arrival: number,
	geometry: ChannelGeometry,
): readonly Point[] {
	const { vertical, railStart, railStep } = geometry;
	const start = at(wire.source, departure, vertical);
	const end = at(wire.target, arrival, vertical);
	if (wire.first === undefined) return [start, end];
	const first = railStart + wire.first.rail * railStep;
	const last = railStart + defined(wire.last).rail * railStep;
	const points = [start, at(wire.source, first, vertical)];
	if (wire.middle !== undefined)
		points.push(at(wire.middle, first, vertical), at(wire.middle, last, vertical));
	points.push(at(wire.target, last, vertical), end);
	return points;
}

interface PrincipalFaces {
	readonly departure: number;
	readonly arrival: number;
}

function nodeFaces(box: Bounds, vertical: boolean, sign: number): PrincipalFaces {
	let minimum = box.y;
	let maximum = box.y + box.height;
	if (!vertical) {
		minimum = box.x;
		maximum = box.x + box.width;
	}
	if (sign < 0) return { departure: minimum, arrival: maximum };
	return { departure: maximum, arrival: minimum };
}

function principalFaces(input: {
	readonly plan: NodeRouting;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly sign: number;
}): { nodes: ReadonlyMap<string, PrincipalFaces>; rows: ReadonlyMap<number, PrincipalFaces> } {
	const nodes = new Map<string, PrincipalFaces>();
	const rows = new Map<number, PrincipalFaces>();
	for (const id of input.plan.quays.sizes.keys()) {
		const rank = input.plan.ranks.get(id);
		if (rank === undefined) continue;
		const face = nodeFaces(defined(input.bounds.get(id)), input.vertical, input.sign);
		nodes.set(id, face);
		const departure = face.departure * input.sign;
		const arrival = face.arrival * input.sign;
		const row = rows.get(rank) ?? { departure, arrival };
		rows.set(rank, {
			departure: Math.max(row.departure, departure),
			arrival: Math.min(row.arrival, arrival),
		});
	}
	return { nodes, rows };
}

/** Materialize a previously reserved channel after row placement, without moving its quays. */
export function applyNodeRouting(input: {
	readonly plan: NodeRouting;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly direction: LayoutDirection;
}): ReadonlyMap<string, readonly Point[]> {
	const vertical = [LayoutDirection.TopToBottom, LayoutDirection.BottomToTop].includes(
		input.direction,
	);
	const decreasing = [LayoutDirection.TopToBottom, LayoutDirection.LeftToRight].includes(
		input.direction,
	);
	let sign = 1;
	if (decreasing) sign = -1;
	const faces = principalFaces({ ...input, vertical, sign });
	const points = new Map<string, readonly Point[]>();
	for (const channel of input.plan.corridors) {
		const rank = channel.corridor.rank;
		const count = defined(input.plan.railCounts.get(rank));
		const start = defined(faces.rows.get(rank + 1)).departure;
		const end = defined(faces.rows.get(rank)).arrival;
		const center = ((start + end) / 2) * sign;
		const halfSpan = ((count - 1) * RAIL_SPACING) / 2;
		const geometry = {
			vertical,
			railStart: center - sign * halfSpan,
			railStep: sign * RAIL_SPACING,
		};
		for (const [index, wire] of channel.wires.entries()) {
			const { relation } = defined(channel.corridor.links[index]);
			const departure = defined(faces.nodes.get(relation.from)).departure;
			const arrival = defined(faces.nodes.get(relation.to)).arrival;
			points.set(wire.id, pointsFor(wire, departure, arrival, geometry));
		}
	}
	return points;
}
