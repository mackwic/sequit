import type { Bounds, Point } from '../../projection/layout-graph';
import { EntityKind, type EntityRef, entityRef } from '../canvas/canvas-entity';
import type { CanvasModel, RenderedCanvasRelation } from '../canvas/canvas-model';

/** An area pointed at on the canvas, in canvas coordinates, with what it touches. */
export interface ReportZone {
	readonly bounds: Bounds;
	readonly entities: readonly EntityRef[];
}

/** An entity under the pointer, with the area it occupies. */
export interface PointedEntity {
	readonly ref: EntityRef;
	readonly bounds: Bounds;
}

/** The rectangle spanned by two corners, whichever way it was drawn. */
export function zoneBetween(from: Point, to: Point): Bounds {
	const x = Math.min(from.x, to.x);
	const y = Math.min(from.y, to.y);
	return { x, y, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}

function within(value: number, start: number, length: number): boolean {
	const end = start + length;
	return value >= start && value <= end;
}

function rangesOverlap(start: number, length: number, otherStart: number, otherLength: number) {
	const end = start + length;
	const otherEnd = otherStart + otherLength;
	return start <= otherEnd && otherStart <= end;
}

function overlaps(left: Bounds, right: Bounds): boolean {
	const horizontal = rangesOverlap(left.x, left.width, right.x, right.width);
	return horizontal && rangesOverlap(left.y, left.height, right.y, right.height);
}

function contains(bounds: Bounds, point: Point): boolean {
	return within(point.x, bounds.x, bounds.width) && within(point.y, bounds.y, bounds.height);
}

function boxes(canvas: CanvasModel): readonly PointedEntity[] {
	return [
		...canvas.junctions.map(({ id, bounds }) => ({
			ref: entityRef(EntityKind.Junction, id),
			bounds,
		})),
		...canvas.nodes.map(({ id, bounds }) => ({ ref: entityRef(EntityKind.Node, id), bounds })),
		...canvas.groups.map(({ id, bounds }) => ({ ref: entityRef(EntityKind.Group, id), bounds })),
	];
}

/** Each straight piece of a route; routes are orthogonal, so a piece is its own bounding box. */
function segments(relation: RenderedCanvasRelation): readonly Bounds[] {
	return relation.points.slice(1).map((to, index) => zoneBetween(relation.points[index] ?? to, to));
}

function distanceToSegment(point: Point, segment: Bounds): number {
	const x = Math.min(Math.max(point.x, segment.x), segment.x + segment.width);
	const y = Math.min(Math.max(point.y, segment.y), segment.y + segment.height);
	return Math.hypot(point.x - x, point.y - y);
}

/** Boxes and routes crossing the zone, in a stable order: junctions, nodes, groups, relations. */
export function entitiesInZone(canvas: CanvasModel, zone: Bounds): readonly EntityRef[] {
	const touched = boxes(canvas)
		.filter(({ bounds }) => overlaps(zone, bounds))
		.map(({ ref }) => ref);
	const relations = canvas.relations
		.filter((relation) => segments(relation).some((segment) => overlaps(zone, segment)))
		.map(({ id }) => entityRef(EntityKind.Relation, id));
	return [...touched, ...relations];
}

/**
 * What a click points at: a junction or a box first, then a route within `tolerance`, then the
 * innermost group under the point.
 */
export function entityAt(
	canvas: CanvasModel,
	point: Point,
	tolerance: number,
): PointedEntity | undefined {
	const under = boxes(canvas).filter(({ bounds }) => contains(bounds, point));
	const box = under.find(({ ref }) => ref.kind !== EntityKind.Group);
	if (box !== undefined) return box;
	const relation = canvas.relations.find((candidate) =>
		segments(candidate).some((segment) => distanceToSegment(point, segment) <= tolerance),
	);
	if (relation !== undefined)
		return {
			ref: entityRef(EntityKind.Relation, relation.id),
			bounds: zoneBetween(...routeExtent(relation)),
		};
	return under
		.filter(({ ref }) => ref.kind === EntityKind.Group)
		.sort((left, right) => area(left.bounds) - area(right.bounds))
		.at(0);
}

function area({ width, height }: Bounds): number {
	return width * height;
}

function routeExtent(relation: RenderedCanvasRelation): readonly [Point, Point] {
	const xs = relation.points.map(({ x }) => x);
	const ys = relation.points.map(({ y }) => y);
	return [
		{ x: Math.min(...xs), y: Math.min(...ys) },
		{ x: Math.max(...xs), y: Math.max(...ys) },
	];
}
