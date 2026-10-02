import { defined, LayoutDirection } from '../../document/logic-document';
import { mainSize, pointOnAxes } from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, Point } from '../layout-types';
import type { ChannelWire } from './channel-types';
import { clearShellDogleg, freeOfGroupShells, type MainInterval } from './group-shells';
import type { NodeRouting } from './reserve-node-routing';

interface ChannelGeometry {
	readonly vertical: boolean;
	readonly railStart: number;
	readonly railStep: number;
	readonly frames: readonly Bounds[];
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
	if (wire.middle === undefined)
		return [
			start,
			pointOnAxes(wire.source, first, vertical),
			pointOnAxes(wire.target, last, vertical),
			end,
		];
	const middle = clearShellDogleg({
		middle: wire.middle,
		source: wire.source,
		target: wire.target,
		first,
		last,
		vertical,
		frames: geometry.frames,
	});
	return [
		start,
		pointOnAxes(wire.source, first, vertical),
		pointOnAxes(middle, first, vertical),
		pointOnAxes(middle, last, vertical),
		pointOnAxes(wire.target, last, vertical),
		end,
	];
}

interface PrincipalFaces {
	readonly departure: number;
	readonly arrival: number;
}

export interface PlannedNodeRoutes {
	readonly byIndex: readonly (readonly Point[] | undefined)[] | undefined;
	readonly byId: ReadonlyMap<string, readonly Point[]> | undefined;
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
}): {
	nodes: ReadonlyMap<string, PrincipalFaces>;
	rows: ReadonlyMap<number, PrincipalFaces>;
} {
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

/** Each channel's free span between its rows and the shells of group frames bordering it. */
function channelSpans(
	input: {
		readonly plan: NodeRouting;
		readonly frames: readonly Bounds[];
		readonly vertical: boolean;
		readonly sign: number;
	},
	rows: ReadonlyMap<number, PrincipalFaces>,
): ReadonlyMap<number, MainInterval> {
	const { plan, frames, vertical, sign } = input;
	const ranks = [...new Set(plan.corridors.map(({ corridor }) => corridor.rank))];
	const gaps = ranks
		.map((rank) => ({
			rank,
			start: defined(rows.get(rank + 1)).departure,
			end: defined(rows.get(rank)).arrival,
		}))
		.sort((left, right) => left.start - right.start);
	const shells = frames.map((box) => {
		let first = box.y;
		if (!vertical) first = box.x;
		const near = first * sign;
		const far = (first + mainSize(box, vertical)) * sign;
		return { start: Math.min(near, far), end: Math.max(near, far) };
	});
	const free = freeOfGroupShells(gaps, shells);
	return new Map(gaps.map(({ rank }, index) => [rank, defined(free[index])]));
}

/** Materialize a previously reserved channel after row placement, without moving its ports. */
export function applyNodeRouting(input: {
	readonly plan: NodeRouting;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly direction: LayoutDirection;
	readonly relationCount: number | undefined;
	/** Populated group frames, whose shells are not routing space. */
	readonly frames: readonly Bounds[];
}): PlannedNodeRoutes {
	const vertical = [LayoutDirection.TopToBottom, LayoutDirection.BottomToTop].includes(
		input.direction,
	);
	const decreasing = [LayoutDirection.TopToBottom, LayoutDirection.LeftToRight].includes(
		input.direction,
	);
	let sign = 1;
	if (decreasing) sign = -1;
	const faces = principalFaces({ ...input, vertical, sign });
	const spans = channelSpans({ ...input, vertical, sign }, faces.rows);
	let byIndex: (readonly Point[] | undefined)[] | undefined;
	let byId: Map<string, readonly Point[]> | undefined;
	if (input.relationCount === undefined) byId = new Map();
	else byIndex = new Array<readonly Point[] | undefined>(input.relationCount);
	for (const channel of input.plan.corridors) {
		const rank = channel.corridor.rank;
		const count = defined(input.plan.railCounts.get(rank));
		const span = defined(spans.get(rank));
		const center = ((span.start + span.end) / 2) * sign;
		const halfSpan = ((count - 1) * RAIL_SPACING) / 2;
		const geometry = {
			vertical,
			railStart: center - sign * halfSpan,
			railStep: sign * RAIL_SPACING,
			frames: input.frames,
		};
		for (let index = 0; index < channel.wires.length; index += 1) {
			const wire = defined(channel.wires[index]);
			const link = defined(channel.corridor.links[index]);
			const { relation } = link;
			const departure = defined(faces.nodes.get(relation.from)).departure;
			const arrival = defined(faces.nodes.get(relation.to)).arrival;
			const points = channelPoints(wire, departure, arrival, geometry);
			if (byIndex !== undefined) byIndex[defined(link.relationIndex)] = points;
			else defined(byId).set(wire.id, points);
		}
	}
	return { byIndex, byId };
}
