import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { onPrincipalFace, segmentEntersInterior } from '../geometry/box-geometry';
import type { Bounds, LayoutRelation, LayoutResult, Point } from '../layout-types';
import type { RouteObstacles as NodeRouteObstacles } from '../routing/route-obstacles';
import { routeHitsObstacles } from '../routing/route-obstacles';
import { sameOwnerGroup } from './element-checks';
import type { DedicatedCandidateValidationInput, RejectedDedicatedCandidate } from './types';
import { DedicatedCandidateRejectionCode, rejected } from './types';

interface RouteObstacles {
	readonly nodes: NodeRouteObstacles;
	readonly groups: readonly LayoutResult['elements'][number][];
}

export function samePoint(first: Point, second: Point): boolean {
	return first.x === second.x && first.y === second.y;
}

function onCanvas(point: Point, layout: LayoutResult): boolean {
	const withinWidth = point.x >= 0 && point.x <= layout.width;
	const withinHeight = point.y >= 0 && point.y <= layout.height;
	return withinWidth && withinHeight;
}

function finitePoint(point: Point): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function routePathBounds(route: LayoutRelation): Bounds {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const point of route.points) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function routeBoundsOverlap(first: Bounds, second: Bounds): boolean {
	const firstRight = first.x + first.width;
	const secondRight = second.x + second.width;
	const horizontalOverlap = first.x <= secondRight && firstRight >= second.x;
	const firstBottom = first.y + first.height;
	const secondBottom = second.y + second.height;
	const verticalOverlap = first.y <= secondBottom && firstBottom >= second.y;
	return horizontalOverlap && verticalOverlap;
}

function routeOwnsGroup(graph: LogicGraph, groupId: string, route: LayoutRelation): boolean {
	if (groupId === route.from || groupId === route.to) return true;
	if (sameOwnerGroup(graph, groupId, route.from)) return true;
	return sameOwnerGroup(graph, groupId, route.to);
}

function invalidRoute(route: LayoutRelation): RejectedDedicatedCandidate {
	return rejected(DedicatedCandidateRejectionCode.Route, undefined, route.id);
}

function validateRoutePoints(
	route: LayoutRelation,
	layout: LayoutResult,
): RejectedDedicatedCandidate | undefined {
	if (route.points.length < 2) return invalidRoute(route);
	for (const point of route.points) {
		if (!finitePoint(point) || !onCanvas(point, layout)) return invalidRoute(route);
	}
	return undefined;
}

function validateAttachments(
	input: DedicatedCandidateValidationInput,
	route: LayoutRelation,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
): RejectedDedicatedCandidate | undefined {
	const first = defined(route.points[0]);
	const last = defined(route.points.at(-1));
	const source = defined(elements.get(route.from)).bounds;
	const target = defined(elements.get(route.to)).bounds;
	const direction = input.graph.document.layout.direction;
	const validSource = onPrincipalFace(first, source, direction, true);
	const validTarget = onPrincipalFace(last, target, direction, false);
	if (validSource && validTarget) return undefined;
	return rejected(DedicatedCandidateRejectionCode.Attachment, undefined, route.id);
}

function validateGroupSegments(
	input: DedicatedCandidateValidationInput,
	route: LayoutRelation,
	groups: RouteObstacles['groups'],
): RejectedDedicatedCandidate | undefined {
	let hasSegment = false;
	for (let index = 1; index < route.points.length; index += 1) {
		const start = defined(route.points[index - 1]);
		const end = defined(route.points[index]);
		if (samePoint(start, end)) continue;
		const orthogonal = start.x === end.x || start.y === end.y;
		if (!orthogonal) return invalidRoute(route);
		hasSegment = true;
		for (const group of groups) {
			if (routeOwnsGroup(input.graph, group.id, route)) continue;
			if (segmentEntersInterior(start, end, group.bounds))
				return rejected(DedicatedCandidateRejectionCode.Obstacle, group.id, route.id);
		}
	}
	if (!hasSegment) return invalidRoute(route);
	return undefined;
}

function validateNodeObstacles(
	route: LayoutRelation,
	nodes: RouteObstacles['nodes'],
): RejectedDedicatedCandidate | undefined {
	if (!routeHitsObstacles(route.points, nodes)) return undefined;
	return rejected(DedicatedCandidateRejectionCode.Obstacle, undefined, route.id);
}

export function routeFailure(
	input: DedicatedCandidateValidationInput,
	route: LayoutRelation,
	elements: ReadonlyMap<string, LayoutResult['elements'][number]>,
	obstacles: RouteObstacles,
): RejectedDedicatedCandidate | undefined {
	const pointFailure = validateRoutePoints(route, input.layout);
	if (pointFailure !== undefined) return pointFailure;
	const attachmentFailure = validateAttachments(input, route, elements);
	if (attachmentFailure !== undefined) return attachmentFailure;
	const groupFailure = validateGroupSegments(input, route, obstacles.groups);
	if (groupFailure !== undefined) return groupFailure;
	return validateNodeObstacles(route, obstacles.nodes);
}
