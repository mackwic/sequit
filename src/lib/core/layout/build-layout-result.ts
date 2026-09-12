import { compareCanonicalStrings } from '../canonical-string';
import { defined, EndpointKind } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { LayoutFrame } from './geometry/layout-frame';
import { OUTER_MARGIN } from './layout-settings';
import type {
	Bounds,
	LayoutElement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
} from './layout-types';
import {
	assertRelationBoundsAreDisjoint,
	routePointsWithGroupHeaders,
} from './routing/endpoint-routes';
import { applyNodeRouting } from './routing/materialize-node-routes';
import type { NodeRouting } from './routing/reserve-node-routing';
import { anchorRouteToQuays } from './routing/route-quay-anchors';

interface ResultInput {
	readonly graph: LogicGraph;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly measurements: LayoutMeasurements;
	readonly routing: NodeRouting | undefined;
	readonly frame: LayoutFrame;
	readonly routes?: ReadonlyMap<string, readonly Point[]> | undefined;
}

function layoutRelation(
	input: ResultInput,
	entry: LogicGraph['relations'][number],
	planned: ReadonlyMap<string, readonly Point[]> | undefined,
): LayoutRelation {
	const { relation, source: sourceEndpoint, target: targetEndpoint } = entry;
	const source = defined(input.bounds.get(relation.from));
	const target = defined(input.bounds.get(relation.to));
	assertRelationBoundsAreDisjoint({
		relationId: relation.id,
		from: relation.from,
		to: relation.to,
		source,
		target,
	});
	let points = input.routes?.get(relation.id) ?? planned?.get(relation.id);
	if (points === undefined) {
		let sourceGroup;
		let targetGroup;
		if (sourceEndpoint.kind === EndpointKind.Group)
			sourceGroup = input.measurements.groups.get(relation.from);
		if (targetEndpoint.kind === EndpointKind.Group)
			targetGroup = input.measurements.groups.get(relation.to);
		const route = routePointsWithGroupHeaders({
			source,
			target,
			direction: input.frame.direction,
			sourceGroup,
			targetGroup,
		});
		points = anchorRouteToQuays(
			route,
			input.routing?.quays.sourceOffsets.get(relation.id) ?? 0,
			input.routing?.quays.targetOffsets.get(relation.id) ?? 0,
			input.frame.vertical,
		);
	}
	return { id: relation.id, from: relation.from, to: relation.to, points };
}

export function buildLayoutResult(input: ResultInput): LayoutResult {
	let planned: ReadonlyMap<string, readonly Point[]> | undefined;
	if (input.routing !== undefined)
		planned = applyNodeRouting({
			plan: input.routing,
			bounds: input.bounds,
			direction: input.frame.direction,
		});
	const relations = input.graph.relations.map((entry) => layoutRelation(input, entry, planned));
	const elements: LayoutElement[] = [];
	let width = OUTER_MARGIN * 2;
	let height = OUTER_MARGIN * 2;
	for (const [id, bounds] of input.bounds) {
		elements.push({ id, kind: defined(input.graph.endpointsById.get(id)).kind, bounds });
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
