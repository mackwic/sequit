import { defined, LayoutDirection } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { isVerticalDirection } from './component-layout';
import type { Bounds, LayoutMeasurements } from './layout-types';
import { BASE_GAP, type NodeRouting, planNodeRouting } from './node-routing';
import { allocateQuays } from './quay-allocation';
import { crossingCorridors } from './routing-corridors';

type Place = (
	measurements: LayoutMeasurements,
	gaps: ReadonlyMap<number, number>,
) => Map<string, Bounds>;

/** Without groups or junctions, rail growth changes only the rank-band translations. */
function expandRankGaps(
	bounds: ReadonlyMap<string, Bounds>,
	ranks: TopologicalRanks,
	plan: NodeRouting,
	direction: LayoutDirection,
): Map<string, Bounds> {
	const vertical = isVerticalDirection(direction);
	const forward = [LayoutDirection.TopToBottom, LayoutDirection.LeftToRight].includes(direction);
	const maximumRank = Math.max(0, ...ranks.byEndpointId.values());
	const shifts = [0];
	for (let rank = 0; rank < maximumRank; rank += 1)
		shifts.push(defined(shifts[rank]) + (plan.gaps.get(rank) ?? BASE_GAP) - BASE_GAP);
	const total = defined(shifts[maximumRank]);
	const expanded = new Map<string, Bounds>();
	for (const [id, box] of bounds) {
		let offset = defined(shifts[defined(ranks.byEndpointId.get(id))]);
		if (!forward) offset = total - offset;
		let moved: Bounds;
		if (vertical) moved = { ...box, y: box.y + offset };
		else moved = { ...box, x: box.x + offset };
		expanded.set(id, moved);
	}
	return expanded;
}

/** Sizes depend on quays; transverse positions determine rails; rails determine row gaps. */
export function prepareNodeLayout(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	place: Place,
): { readonly bounds: Map<string, Bounds>; readonly routing?: NodeRouting } {
	const initial = place(measurements, new Map());
	const vertical = isVerticalDirection(graph.document.layout.direction);
	const corridors = crossingCorridors({
		graph,
		ranks: ranks.byEndpointId,
		bounds: initial,
		vertical,
	});
	if (corridors.length === 0) return { bounds: initial };
	const quays = allocateQuays({
		corridors,
		sizes: measurements.nodes,
		vertical,
		graph,
		bounds: initial,
	});
	const sized = { ...measurements, nodes: quays.sizes };
	const transverse = place(sized, new Map());
	const routing = planNodeRouting({
		corridors,
		quays,
		bounds: transverse,
		vertical,
		ranks: ranks.byEndpointId,
	});
	let bounds: Map<string, Bounds>;
	if (graph.document.groups.length === 0 && graph.document.junctions.length === 0)
		bounds = expandRankGaps(transverse, ranks, routing, graph.document.layout.direction);
	else bounds = place(sized, routing.gaps);
	return { bounds, routing };
}
