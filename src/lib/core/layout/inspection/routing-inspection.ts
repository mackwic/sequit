import { defined, EndpointKind, type LayoutDirection } from '../../document/logic-document';
import { isVerticalDirection, mainSize, transverseCenter } from '../geometry/layout-frame';
import { BASE_RANK_GAP } from '../layout-settings';
import {
	type Bounds,
	type InspectedCorridor,
	type InspectedNode,
	type InspectedQuay,
	type InspectedRail,
	type LayoutElement,
	type LayoutMeasurements,
	type LayoutRelation,
	type LayoutResult,
	type RoutingInspection,
	RoutingQuaySide,
} from '../layout-types';
import { quayExtent } from '../routing/quay-allocation';
import type { NodeRouting } from '../routing/reserve-node-routing';

function usedQuays(id: string, routes: readonly LayoutRelation[]): InspectedQuay[] {
	const quays = new Map<string, InspectedQuay>();
	for (const route of routes) {
		if (route.from !== id && route.to !== id) continue;
		let side: InspectedQuay['side'] = RoutingQuaySide.Incoming;
		let point = defined(route.points.at(-1));
		if (route.from === id) {
			side = RoutingQuaySide.Outgoing;
			point = defined(route.points[0]);
		}
		const key = `${side}:${point.x}:${point.y}`;
		const quay = quays.get(key) ?? { side, point, relations: [] };
		quay.relations.push(route.id);
		quays.set(key, quay);
	}
	return [...quays.values()];
}

function minimum(
	quays: readonly InspectedQuay[],
	offsets: ReadonlyMap<string, number>,
	kind: EndpointKind,
): number {
	const reserved = quays.filter((quay) => quay.relations.some((id) => offsets.has(id)));
	if (reserved.length === 0) return 0;
	return quayExtent(reserved.length, kind);
}

function nodesFor(input: InspectionInput): InspectedNode[] {
	return input.layout.elements
		.filter((element) => element.kind !== EndpointKind.Group)
		.map((node) => {
			let measurements = input.measurements.nodes;
			if (node.kind === EndpointKind.Junction) measurements = input.measurements.junctions;
			const measured = defined(measurements.get(node.id));
			const quays = usedQuays(node.id, input.layout.relations);
			const content = {
				...measured,
				x: node.bounds.x + (node.bounds.width - measured.width) / 2,
				y: node.bounds.y + (node.bounds.height - measured.height) / 2,
			};
			// Content outlines explain the transverse reservation, not text placement inside the box.
			return {
				id: node.id,
				content,
				quays,
				incomingMinimum: minimum(
					quays.filter((quay) => quay.side === RoutingQuaySide.Incoming),
					input.plan?.quays.targetOffsets ?? new Map(),
					node.kind,
				),
				outgoingMinimum: minimum(
					quays.filter((quay) => quay.side === RoutingQuaySide.Outgoing),
					input.plan?.quays.sourceOffsets ?? new Map(),
					node.kind,
				),
			};
		});
}

function envelope(boxes: readonly Bounds[]): Bounds {
	const x = Math.min(...boxes.map((box) => box.x));
	const y = Math.min(...boxes.map((box) => box.y));
	return {
		x,
		y,
		width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
		height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
	};
}

function band(a: Bounds, b: Bounds, vertical: boolean): Bounds {
	const all = envelope([a, b]);
	if (vertical) {
		const y = Math.min(a.y + a.height, b.y + b.height);
		return { x: all.x, y, width: all.width, height: Math.max(a.y, b.y) - y };
	}
	const x = Math.min(a.x + a.width, b.x + b.width);
	return { x, y: all.y, width: Math.max(a.x, b.x) - x, height: all.height };
}

function railsFor(routes: readonly LayoutRelation[], vertical: boolean): InspectedRail[] {
	const rails = new Map<number, InspectedRail>();
	for (const route of routes)
		for (let index = 1; index < route.points.length; index += 1) {
			const a = defined(route.points[index - 1]);
			const b = defined(route.points[index]);
			const sameX = a.x === b.x;
			const sameY = a.y === b.y;
			let transverse = sameX && !sameY;
			let coordinate = a.x;
			if (vertical) {
				transverse = sameY && !sameX;
				coordinate = a.y;
			}
			if (!transverse) continue;
			const rail = rails.get(coordinate) ?? { coordinate, relations: [] };
			if (!rail.relations.includes(route.id)) rail.relations.push(route.id);
			rails.set(coordinate, rail);
		}
	return [...rails.values()].sort((a, b) => a.coordinate - b.coordinate);
}

function junctionsInBand(
	elements: readonly LayoutElement[],
	bounds: Bounds,
	vertical: boolean,
): readonly LayoutElement[] {
	const center = transverseCenter(bounds, !vertical);
	const half = mainSize(bounds, vertical) / 2;
	return elements.filter((element) => {
		if (element.kind !== EndpointKind.Junction) return false;
		return Math.abs(transverseCenter(element.bounds, !vertical) - center) < half;
	});
}

function occupiedRails(
	routes: readonly LayoutRelation[],
	junctions: readonly LayoutElement[],
	bounds: Bounds,
	vertical: boolean,
): InspectedRail[] {
	const center = transverseCenter(bounds, !vertical);
	const half = mainSize(bounds, vertical) / 2;
	const rails = new Map(
		railsFor(routes, vertical)
			.filter((rail) => Math.abs(rail.coordinate - center) < half)
			.map((rail) => [rail.coordinate, rail]),
	);
	for (const junction of junctions) {
		const coordinate = transverseCenter(junction.bounds, !vertical);
		const rail = rails.get(coordinate) ?? { coordinate, relations: [] };
		rails.set(coordinate, { ...rail, junctions: [...(rail.junctions ?? []), junction.id] });
	}
	return [...rails.values()].sort((a, b) => a.coordinate - b.coordinate);
}

function corridorsFor(input: InspectionInput, vertical: boolean): InspectedCorridor[] {
	const rows = new Map<number, Bounds[]>();
	const nodeIds = new Set<string>();
	for (const node of input.layout.elements) {
		if (node.kind !== EndpointKind.Node) continue;
		nodeIds.add(node.id);
		const rank = defined(input.ranks.get(node.id));
		const row = rows.get(rank) ?? [];
		row.push(node.bounds);
		rows.set(rank, row);
	}
	const corridors: InspectedCorridor[] = [];
	for (const [rank, row] of rows) {
		const next = rows.get(rank + 1);
		if (next === undefined) continue;
		const bounds = band(envelope(row), envelope(next), vertical);
		const junctions = junctionsInBand(input.layout.elements, bounds, vertical);
		let routes: readonly LayoutRelation[] = input.layout.relations.filter((route) => {
			const nodes = nodeIds.has(route.from) && nodeIds.has(route.to);
			const sourceRank = rank + 1;
			const adjacent =
				input.ranks.get(route.to) === rank && input.ranks.get(route.from) === sourceRank;
			return nodes && adjacent;
		});
		let requiredGap = input.plan?.gaps.get(rank) ?? BASE_RANK_GAP;
		let allocated = input.plan?.gaps.has(rank) ?? false;
		if (junctions.length > 0) {
			routes = input.layout.relations;
			requiredGap = mainSize(bounds, vertical);
			allocated = true;
		}
		if (routes.length === 0) continue;
		corridors.push({
			rank,
			bounds,
			requiredGap,
			allocated,
			rails: occupiedRails(routes, junctions, bounds, vertical),
		});
	}
	return corridors.sort((a, b) => a.rank - b.rank);
}

interface InspectionInput {
	readonly layout: LayoutResult;
	readonly measurements: LayoutMeasurements;
	readonly ranks: ReadonlyMap<string, number>;
	readonly direction: LayoutDirection;
	readonly plan: NodeRouting | undefined;
}

/** Opt-in explanation of the actual placement. It never reroutes or moves geometry. */
export function inspectRouting(input: InspectionInput): RoutingInspection {
	const vertical = isVerticalDirection(input.direction);
	return { vertical, nodes: nodesFor(input), corridors: corridorsFor(input, vertical) };
}
