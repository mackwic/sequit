import { defined, LayoutDirection } from '../../document/logic-document';
import { pointOnAxes } from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, Point } from '../layout-types';
import type { ChannelWire } from './channel-types';
import type { NodeRouting } from './reserve-node-routing';

interface ChannelGeometry {
	readonly vertical: boolean;
	readonly railStart: number;
	readonly railStep: number;
}

export function channelPoints(
	wire: ChannelWire,
	departure: number,
	arrival: number,
	geometry: ChannelGeometry,
): readonly Point[] {
	const { vertical, railStart, railStep } = geometry;
	const start = pointOnAxes(wire.source, departure, vertical);
	const end = pointOnAxes(wire.target, arrival, vertical);
	if (wire.first === undefined) return [start, end];
	const first = railStart + wire.first.rail * railStep;
	const last = railStart + defined(wire.last).rail * railStep;
	const points = [start, pointOnAxes(wire.source, first, vertical)];
	if (wire.middle !== undefined)
		points.push(
			pointOnAxes(wire.middle, first, vertical),
			pointOnAxes(wire.middle, last, vertical),
		);
	points.push(pointOnAxes(wire.target, last, vertical), end);
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
	for (const id of input.plan.ports.sizes.keys()) {
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

/** Materialize a previously reserved channel after row placement, without moving its ports. */
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
			points.set(wire.id, channelPoints(wire, departure, arrival, geometry));
		}
	}
	return points;
}
