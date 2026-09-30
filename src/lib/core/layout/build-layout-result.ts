import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { LayoutFrame } from './geometry/layout-frame';
import { clearGroupEndpointRoutes } from './group-endpoint-routing';
import { OUTER_MARGIN } from './layout-settings';
import type { Bounds, LayoutElement, LayoutRelation, LayoutResult, Point } from './layout-types';
import { assertRelationBoundsAreDisjoint, routePoints } from './routing/endpoint-routes';
import { applyNodeRouting, type PlannedNodeRoutes } from './routing/materialize-node-routes';
import { relationPortOffset } from './routing/relation-port-offsets';
import type { NodeRouting } from './routing/reserve-node-routing';
import { corridorsIndexGraph } from './routing/routing-corridors';
import { directRouteRail, type RoutingSpace } from './routing/routing-space';

interface ResultInput {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly routing: NodeRouting | undefined;
	readonly frame: LayoutFrame;
	readonly routes?: ReadonlyMap<string, readonly Point[]> | undefined;
	readonly space: RoutingSpace;
}

function layoutRelation(
	input: ResultInput,
	entry: LogicGraph['relations'][number],
	index: number,
	planned: PlannedNodeRoutes | undefined,
): LayoutRelation {
	const { relation } = entry;
	const source = defined(input.bounds.get(relation.from));
	const target = defined(input.bounds.get(relation.to));
	assertRelationBoundsAreDisjoint({
		relationId: relation.id,
		from: relation.from,
		to: relation.to,
		source,
		target,
	});
	const points =
		input.routes?.get(relation.id) ??
		planned?.byIndex?.[index] ??
		planned?.byId?.get(relation.id) ??
		routePoints({
			source,
			target,
			direction: input.frame.direction,
			rail: directRouteRail(input.space, relation.from, relation.to),
			sourceOffset: relationPortOffset(input.routing?.ports.sourceOffsets, input.graph, index),
			targetOffset: relationPortOffset(input.routing?.ports.targetOffsets, input.graph, index),
		});
	return { id: relation.id, from: relation.from, to: relation.to, points };
}

export function buildLayoutResult(input: ResultInput): LayoutResult {
	let planned: PlannedNodeRoutes | undefined;
	if (input.routing !== undefined) {
		let relationCount: number | undefined;
		const corridors = input.routing.corridors.map(({ corridor }) => corridor);
		if (corridorsIndexGraph(corridors, input.graph)) relationCount = input.graph.relations.length;
		planned = applyNodeRouting({
			plan: input.routing,
			bounds: input.bounds,
			direction: input.frame.direction,
			relationCount,
			frames: [...input.space.enclosingGroups].flatMap((id) => input.bounds.get(id) ?? []),
		});
	}
	const relations = input.graph.relations.map((entry, index) =>
		layoutRelation(input, entry, index, planned),
	);
	clearGroupEndpointRoutes(input.graph, input.bounds, input.frame, relations);
	const elements: LayoutElement[] = [];
	let width = OUTER_MARGIN * 2;
	let height = OUTER_MARGIN * 2;
	for (const [id, bounds] of input.bounds) {
		elements.push({
			id,
			kind: defined(input.graph.endpointsById.get(id)).kind,
			bounds,
		});
		width = Math.max(width, bounds.x + bounds.width + OUTER_MARGIN);
		height = Math.max(height, bounds.y + bounds.height + OUTER_MARGIN);
	}
	elements.sort((left, right) => compareCanonicalStrings(left.id, right.id));
	for (const route of relations)
		for (const point of route.points) {
			width = Math.max(width, point.x + OUTER_MARGIN);
			height = Math.max(height, point.y + OUTER_MARGIN);
		}
	relations.sort((left, right) => compareCanonicalStrings(left.id, right.id));
	return { width, height, elements, relations };
}
