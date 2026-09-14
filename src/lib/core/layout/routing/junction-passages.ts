import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, Point, RoutingLayers } from '../layout-types';
import { prepareRouteObstacles, routeHitsObstacles, type RouteObstacles } from './route-obstacles';

interface PassageInput {
	readonly graph: LogicGraph;
	readonly layers: RoutingLayers;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly sourceOffsets?: ReadonlyMap<string, number> | undefined;
	readonly targetOffsets?: ReadonlyMap<string, number> | undefined;
}

interface PassageWorkspace extends PassageInput {
	readonly obstacles: Map<number, RouteObstacles | undefined>;
	readonly reservations: Map<number, number[]>;
}

function column(coordinate: number, box: Bounds, vertical: boolean): Point {
	if (vertical) return { x: coordinate, y: box.y + box.height / 2 };
	return { x: box.x + box.width / 2, y: coordinate };
}

/** Position in a sorted reservation list, leaving one rail step between unrelated passages. */
function insertionIndex(positions: readonly number[], coordinate: number): number | undefined {
	let start = 0;
	let end = positions.length;
	while (start < end) {
		const middle = Math.floor((start + end) / 2);
		if (defined(positions[middle]) < coordinate) start = middle + 1;
		else end = middle;
	}
	const before = coordinate - (positions[start - 1] ?? Number.NEGATIVE_INFINITY);
	const after = (positions[start] ?? Number.POSITIVE_INFINITY) - coordinate;
	if (before < RAIL_SPACING || after < RAIL_SPACING) return undefined;
	return start;
}

function obstaclesIn(input: PassageWorkspace, layer: number): RouteObstacles | undefined {
	const { obstacles } = input;
	if (!obstacles.has(layer)) {
		const row = defined(input.layers.rows[layer]);
		const junctionsOnly = row.every(
			(id) => input.graph.endpointsById.get(id)?.kind === EndpointKind.Junction,
		);
		let index;
		if (junctionsOnly)
			index = prepareRouteObstacles(
				row.map((id) => defined(input.bounds.get(id))),
				RAIL_SPACING,
			);
		obstacles.set(layer, index);
	}
	return obstacles.get(layer);
}

function reservePassage(input: PassageWorkspace, relation: LogicRelation): number | undefined {
	if (input.graph.endpointsById.get(relation.from)?.kind !== EndpointKind.Node) return undefined;
	if (input.graph.endpointsById.get(relation.to)?.kind !== EndpointKind.Node) return undefined;
	const sourceLayer = defined(input.layers.byId.get(relation.from));
	const targetLayer = defined(input.layers.byId.get(relation.to));
	if (sourceLayer <= targetLayer + 1) return undefined;
	const crossed: RouteObstacles[] = [];
	for (let layer = targetLayer + 1; layer < sourceLayer; layer += 1) {
		const index = obstaclesIn(input, layer);
		if (index === undefined) return undefined;
		crossed.push(index);
	}
	const source = defined(input.bounds.get(relation.from));
	const target = defined(input.bounds.get(relation.to));
	const sourceOffset = input.sourceOffsets?.get(relation.id) ?? 0;
	const targetOffset = input.targetOffsets?.get(relation.id) ?? 0;
	const candidates = [
		transverseCenter(source, input.vertical) + sourceOffset,
		transverseCenter(target, input.vertical) + targetOffset,
	];
	// With no ordinary row between the endpoints, overlapping ranges have the same boundaries.
	const positions = input.reservations.get(targetLayer) ?? [];
	for (const candidate of candidates) {
		const at = insertionIndex(positions, candidate);
		if (at === undefined) continue;
		const points = [
			column(candidate, source, input.vertical),
			column(candidate, target, input.vertical),
		];
		if (crossed.some((index) => routeHitsObstacles(points, index))) continue;
		positions.splice(at, 0, candidate);
		input.reservations.set(targetLayer, positions);
		return candidate;
	}
	return undefined;
}

/** A new allocator belongs to one geometry phase; nothing survives the next placement. */
export function junctionPassages(
	input: PassageInput,
): (relation: LogicRelation) => number | undefined {
	const workspace: PassageWorkspace = { ...input, obstacles: new Map(), reservations: new Map() };
	return (relation) => reservePassage(workspace, relation);
}
