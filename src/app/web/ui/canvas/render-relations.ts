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

function appendSegment(segments: Segment[], segment: Segment): void {
	const last = segments.at(-1);
	if (last === undefined) {
		segments.push(segment);
		return;
	}
	const contiguous = last.end.x === segment.start.x && last.end.y === segment.start.y;
	const previousDirection =
		Math.sign(last.end.x - last.start.x) + Math.sign(last.end.y - last.start.y);
	const nextDirection =
		Math.sign(segment.end.x - segment.start.x) + Math.sign(segment.end.y - segment.start.y);
	const sameOrientation = last.orientation === segment.orientation;
	const merge = contiguous && sameOrientation && previousDirection === nextDirection;
	if (merge) {
		segments.pop();
		segments.push({ ...segment, start: last.start });
		return;
	}
	segments.push(segment);
}

function segmentsFor(relation: LayoutRelation): readonly Segment[] {
	const segments: Segment[] = [];
	let start: Point | undefined;
	for (const end of relation.points) {
		if (start) {
			const segment = segmentBetween(start, end);
			if (segment) appendSegment(segments, segment);
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

function hasBridgeSpace(segment: Segment, point: Point): boolean {
	const distance = distanceAlong(segment, point);
	const remaining = distanceAlong(segment, segment.end) - distance;
	return distance >= BRIDGE_RADIUS && remaining >= BRIDGE_RADIUS;
}

function canCarryBridge(
	segment: Segment,
	point: Point,
	crossings: ReadonlyMap<Segment, readonly Point[]>,
): boolean {
	if (!hasBridgeSpace(segment, point)) return false;
	const distance = distanceAlong(segment, point);
	return (crossings.get(segment) ?? []).every((previous) => {
		const separation = Math.abs(distanceAlong(segment, previous) - distance);
		const diameter = BRIDGE_RADIUS * 2;
		return separation === 0 || separation >= diameter;
	});
}

function recordIntersection(
	crossings: Map<Segment, Point[]>,
	segment: Segment,
	previous: Segment,
): void {
	const point = intersection(segment, previous);
	if (!point) return;
	let carrier = segment;
	if (!canCarryBridge(carrier, point, crossings)) {
		if (!canCarryBridge(previous, point, crossings)) return;
		carrier = previous;
	}
	const points = crossings.get(carrier) ?? [];
	if (points.some((candidate) => candidate.x === point.x && candidate.y === point.y)) return;
	points.push(point);
	crossings.set(carrier, points);
}

export function renderRelationPaths(
	relations: readonly LayoutRelation[],
): readonly RenderedRelation[] {
	const previousSegments: Segment[] = [];
	const crossings = new Map<Segment, Point[]>();
	const byRelation = relations.map(segmentsFor);
	for (const segments of byRelation) {
		for (const segment of segments) {
			for (const previous of previousSegments) recordIntersection(crossings, segment, previous);
		}
		previousSegments.push(...segments);
	}
	return relations.map((relation, relationIndex) => {
		const segments = byRelation[relationIndex] ?? [];
		return {
			...relation,
			path: pathFor(segments, crossings),
			color: relationColor(relationIndex),
		};
	});
}
