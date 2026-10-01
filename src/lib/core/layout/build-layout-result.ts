import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { relationIndexesInIdOrder } from '../graph/documentary-relations';
import type { LayoutFrame } from './geometry/layout-frame';
import { clearGroupEndpointRoutes } from './group-endpoint-routing';
import { OUTER_MARGIN } from './layout-settings';
import type { Bounds, LayoutElement, LayoutRelation, LayoutResult, Point } from './layout-types';
import type { ChannelRoutingCache } from './routing/channel-routing-cache';
import { assertRelationBoundsAreDisjoint, routePoints } from './routing/endpoint-routes';
import { applyNodeRouting, type PlannedNodeRoutes } from './routing/materialize-node-routes';
import { relationPortOffset } from './routing/relation-port-offsets';
import type { NodeRouting } from './routing/reserve-node-routing';
import { corridorsIndexGraph, relationPositions } from './routing/routing-corridors';
import { directRouteRail, type RoutingSpace } from './routing/routing-space';

interface ResultInput {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly routing: NodeRouting | undefined;
	readonly channels?: ChannelRoutingCache | undefined;
	readonly frame: LayoutFrame;
	readonly routes?: ReadonlyMap<string, readonly Point[]> | undefined;
	readonly space: RoutingSpace;
}

interface ProjectionRelationOrder {
	ids: string[];
	readonly byId: Set<string>;
}

const orderByProjection = new WeakMap<ChannelRoutingCache, ProjectionRelationOrder>();

interface LayoutResultOrder {
	readonly endpointIds: readonly string[];
}

const orderByGraph = new WeakMap<LogicGraph, LayoutResultOrder>();

function layoutResultOrder(graph: LogicGraph): LayoutResultOrder {
	const cached = orderByGraph.get(graph);
	if (cached !== undefined) return cached;
	const order = {
		endpointIds: [...graph.endpointsById.keys()].toSorted(compareCanonicalStrings),
	};
	orderByGraph.set(graph, order);
	return order;
}

function mergeRelationIds(previous: string[], additions: readonly string[]): void {
	const initialLength = previous.length;
	for (const id of additions) previous.push(id);
	let previousIndex = initialLength - 1;
	let additionIndex = additions.length - 1;
	let targetIndex = previous.length - 1;
	while (previousIndex >= 0 && additionIndex >= 0) {
		const previousId = defined(previous[previousIndex]);
		const additionId = defined(additions[additionIndex]);
		if (compareCanonicalStrings(previousId, additionId) > 0) {
			previous[targetIndex] = previousId;
			previousIndex -= 1;
		} else {
			previous[targetIndex] = additionId;
			additionIndex -= 1;
		}
		targetIndex -= 1;
	}
	while (additionIndex >= 0) {
		previous[targetIndex] = defined(additions[additionIndex]);
		additionIndex -= 1;
		targetIndex -= 1;
	}
}

interface IndexedRelationOrder {
	readonly ids: readonly string[];
	readonly positions: ReadonlyMap<string, number>;
}

function createProjectionOrder(graph: LogicGraph): ProjectionRelationOrder {
	const ids = graph.relations.map(({ relation }) => relation.id).toSorted(compareCanonicalStrings);
	return { ids, byId: new Set(ids) };
}

function updateProjectionOrder(
	graph: LogicGraph,
	cached: ProjectionRelationOrder,
	positions: ReadonlyMap<string, number>,
): ProjectionRelationOrder {
	const ids = cached.ids.filter((id) => positions.has(id));
	const byId = new Set(ids);
	const additions: string[] = [];
	for (const { relation } of graph.relations)
		if (!byId.has(relation.id)) {
			additions.push(relation.id);
			byId.add(relation.id);
		}
	additions.sort(compareCanonicalStrings);
	mergeRelationIds(ids, additions);
	return { ids, byId };
}

function projectionRelationOrder(
	graph: LogicGraph,
	channels: ChannelRoutingCache,
): IndexedRelationOrder | undefined {
	const positions = relationPositions(graph);
	if (positions.size !== graph.relations.length) return undefined;
	const cached = orderByProjection.get(channels);
	if (cached === undefined) {
		const order = createProjectionOrder(graph);
		orderByProjection.set(channels, order);
		return { ids: order.ids, positions };
	}
	if (cached.ids.every((id) => positions.has(id))) {
		const additions: string[] = [];
		for (const { relation } of graph.relations)
			if (!cached.byId.has(relation.id)) {
				additions.push(relation.id);
				cached.byId.add(relation.id);
			}
		if (additions.length === 0) return { ids: cached.ids, positions };
		additions.sort(compareCanonicalStrings);
		mergeRelationIds(cached.ids, additions);
		return { ids: cached.ids, positions };
	}
	const order = updateProjectionOrder(graph, cached, positions);
	orderByProjection.set(channels, order);
	return { ids: order.ids, positions };
}

function sortRelationsById(relations: LayoutRelation[]): void {
	relations.sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

function orderResultRelations(input: ResultInput, relations: LayoutRelation[]): void {
	if (input.channels === undefined) {
		const indexes = relationIndexesInIdOrder(input.graph.relations);
		permuteRoutes(relations, (target) => defined(indexes[target]));
		return;
	}
	const outputOrder = projectionRelationOrder(input.graph, input.channels);
	if (outputOrder === undefined) {
		sortRelationsById(relations);
		return;
	}
	const { ids, positions } = outputOrder;
	permuteRoutes(relations, (target) => defined(positions.get(defined(ids[target]))));
}

/** Moves `routes[sourceOf(target)]` to `target` in place, one permutation cycle at a time. */
function permuteRoutes(routes: LayoutRelation[], sourceOf: (target: number) => number): void {
	const visited = new Uint8Array(routes.length);
	for (let start = 0; start < routes.length; start += 1) {
		if (defined(visited[start]) !== 0) continue;
		let current = start;
		const first = defined(routes[start]);
		do {
			visited[current] = 1;
			const source = sourceOf(current);
			if (source === start) routes[current] = first;
			else routes[current] = defined(routes[source]);
			current = source;
		} while (current !== start);
	}
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
	const order = layoutResultOrder(input.graph);
	const relations = input.graph.relations.map((entry, index) =>
		layoutRelation(input, entry, index, planned),
	);
	clearGroupEndpointRoutes(input.graph, input.bounds, input.frame, relations);
	orderResultRelations(input, relations);
	const elements: LayoutElement[] = [];
	let width = OUTER_MARGIN * 2;
	let height = OUTER_MARGIN * 2;
	for (const id of order.endpointIds) {
		const bounds = input.bounds.get(id);
		if (bounds === undefined) continue;
		elements.push({
			id,
			kind: defined(input.graph.endpointsById.get(id)).kind,
			bounds,
		});
		width = Math.max(width, bounds.x + bounds.width + OUTER_MARGIN);
		height = Math.max(height, bounds.y + bounds.height + OUTER_MARGIN);
	}
	if (input.bounds.size > elements.length)
		for (const id of input.bounds.keys())
			if (!input.graph.endpointsById.has(id))
				throw new Error(`Layout bounds name an unknown endpoint: ${id}`);
	for (const route of relations)
		for (const point of route.points) {
			width = Math.max(width, point.x + OUTER_MARGIN);
			height = Math.max(height, point.y + OUTER_MARGIN);
		}
	return { width, height, elements, relations };
}
