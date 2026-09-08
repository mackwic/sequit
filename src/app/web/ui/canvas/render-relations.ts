import type { LayoutRelation, Point } from '../../projection/layout-graph';

const BRIDGE_RADIUS = 6;
const RELATION_COLORS = ['#78716c', '#817a75', '#6f6a65', '#89817c'] as const;
function relationColor(index: number): (typeof RELATION_COLORS)[number] {
	switch (index % RELATION_COLORS.length) {
		case 0:
			return RELATION_COLORS[0];
		case 1:
			return RELATION_COLORS[1];
		case 2:
			return RELATION_COLORS[2];
		default:
			return RELATION_COLORS[3];
	}
}

enum Orientation {
	Horizontal = 'horizontal',
	Vertical = 'vertical',
}

interface Segment {
	readonly start: Point;
	readonly end: Point;
	readonly orientation: Orientation;
}

export interface RenderedRelation extends LayoutRelation {
	readonly path: string;
	readonly color: string;
}

function segmentBetween(start: Point, end: Point): Segment | undefined {
	if (start.x === end.x && start.y !== end.y) {
		return { start, end, orientation: Orientation.Vertical };
	}
	if (start.y === end.y && start.x !== end.x) {
		return { start, end, orientation: Orientation.Horizontal };
	}
	return undefined;
}

function segmentsFor(relation: LayoutRelation): readonly Segment[] {
	const segments: Segment[] = [];
	let start: Point | undefined;
	for (const end of relation.points) {
		if (start) {
			const segment = segmentBetween(start, end);
			if (segment) segments.push(segment);
		}
		start = end;
	}
	return segments;
}

function strictlyBetween(value: number, first: number, second: number): boolean {
	return value > Math.min(first, second) && value < Math.max(first, second);
}

function intersection(current: Segment, other: Segment): Point | undefined {
	if (current.orientation === other.orientation) return undefined;
	const horizontal = current.orientation === Orientation.Horizontal ? current : other;
	const vertical = current.orientation === Orientation.Vertical ? current : other;
	const point = { x: vertical.start.x, y: horizontal.start.y };
	return strictlyBetween(point.x, horizontal.start.x, horizontal.end.x) &&
		strictlyBetween(point.y, vertical.start.y, vertical.end.y)
		? point
		: undefined;
}

function distanceAlong(segment: Segment, point: Point): number {
	const horizontalDistance = Math.abs(point.x - segment.start.x);
	const verticalDistance = Math.abs(point.y - segment.start.y);
	return segment.orientation === Orientation.Horizontal ? horizontalDistance : verticalDistance;
}

function pointAlong(segment: Segment, distance: number): Point {
	if (segment.orientation === Orientation.Horizontal) {
		return {
			x: segment.start.x + Math.sign(segment.end.x - segment.start.x) * distance,
			y: segment.start.y,
		};
	}
	return {
		x: segment.start.x,
		y: segment.start.y + Math.sign(segment.end.y - segment.start.y) * distance,
	};
}

enum PathCommand {
	Move = 'M',
	Line = 'L',
}

function pointCommand(command: PathCommand, point: Point): string {
	return `${command} ${point.x} ${point.y}`;
}

function pathFor(
	segments: readonly Segment[],
	crossings: ReadonlyMap<Segment, readonly Point[]>,
): string {
	const first = segments.at(0);
	if (!first) return '';
	const commands = [pointCommand(PathCommand.Move, first.start)];
	let cursor = first.start;
	for (const segment of segments) {
		if (cursor.x !== segment.start.x || cursor.y !== segment.start.y) {
			commands.push(pointCommand(PathCommand.Line, segment.start));
		}
		const length = distanceAlong(segment, segment.end);
		const lastBridgeCenter = length - BRIDGE_RADIUS;
		const distances = [...(crossings.get(segment) ?? [])]
			.map((point) => distanceAlong(segment, point))
			.filter((distance) => distance >= BRIDGE_RADIUS && distance <= lastBridgeCenter)
			.sort((left, right) => left - right);
		let coveredUntil = 0;
		for (const distance of distances) {
			if (distance - BRIDGE_RADIUS < coveredUntil) continue;
			const before = pointAlong(segment, distance - BRIDGE_RADIUS);
			const after = pointAlong(segment, distance + BRIDGE_RADIUS);
			commands.push(pointCommand(PathCommand.Line, before));
			commands.push(`A ${BRIDGE_RADIUS} ${BRIDGE_RADIUS} 0 0 1 ${after.x} ${after.y}`);
			coveredUntil = distance + BRIDGE_RADIUS;
		}
		commands.push(pointCommand(PathCommand.Line, segment.end));
		cursor = segment.end;
	}
	return commands.join(' ');
}

function recordIntersection(
	crossings: Map<Segment, Point[]>,
	segment: Segment,
	previous: Segment,
): void {
	const point = intersection(segment, previous);
	if (!point) return;
	const points = crossings.get(segment) ?? [];
	if (points.some((candidate) => candidate.x === point.x && candidate.y === point.y)) return;
	points.push(point);
	crossings.set(segment, points);
}

export function renderRelationPaths(
	relations: readonly LayoutRelation[],
): readonly RenderedRelation[] {
	const previousSegments: Segment[] = [];
	return relations.map((relation, relationIndex) => {
		const segments = segmentsFor(relation);
		const crossings = new Map<Segment, Point[]>();
		for (const segment of segments) {
			for (const previous of previousSegments) {
				recordIntersection(crossings, segment, previous);
			}
		}
		previousSegments.push(...segments);
		const color = relationColor(relationIndex);
		return {
			...relation,
			path: pathFor(segments, crossings),
			color,
		};
	});
}
