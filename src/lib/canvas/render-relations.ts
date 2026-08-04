import type { LayoutRelation, Point } from '../layout/layout-graph';

const BRIDGE_RADIUS = 6;
const RELATION_COLORS = ['#78716c', '#817a75', '#6f6a65', '#89817c'] as const;

type Orientation = 'horizontal' | 'vertical';

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
	if (start.x === end.x && start.y !== end.y) return { start, end, orientation: 'vertical' };
	if (start.y === end.y && start.x !== end.x) return { start, end, orientation: 'horizontal' };
	return undefined;
}

function segmentsFor(relation: LayoutRelation): readonly Segment[] {
	const segments: Segment[] = [];
	for (let index = 1; index < relation.points.length; index += 1) {
		const segment = segmentBetween(relation.points[index - 1], relation.points[index]);
		if (segment) segments.push(segment);
	}
	return segments;
}

function strictlyBetween(value: number, first: number, second: number): boolean {
	return value > Math.min(first, second) && value < Math.max(first, second);
}

function intersection(current: Segment, other: Segment): Point | undefined {
	if (current.orientation === other.orientation) return undefined;
	const horizontal = current.orientation === 'horizontal' ? current : other;
	const vertical = current.orientation === 'vertical' ? current : other;
	const point = { x: vertical.start.x, y: horizontal.start.y };
	return strictlyBetween(point.x, horizontal.start.x, horizontal.end.x) &&
		strictlyBetween(point.y, vertical.start.y, vertical.end.y)
		? point
		: undefined;
}

function distanceAlong(segment: Segment, point: Point): number {
	return segment.orientation === 'horizontal'
		? Math.abs(point.x - segment.start.x)
		: Math.abs(point.y - segment.start.y);
}

function pointAlong(segment: Segment, distance: number): Point {
	if (segment.orientation === 'horizontal') {
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

function pointCommand(command: 'M' | 'L', point: Point): string {
	return `${command} ${point.x} ${point.y}`;
}

function pathFor(
	segments: readonly Segment[],
	crossings: ReadonlyMap<Segment, readonly Point[]>,
): string {
	const first = segments.at(0);
	if (!first) return '';
	const commands = [pointCommand('M', first.start)];
	let cursor = first.start;
	for (const segment of segments) {
		if (cursor.x !== segment.start.x || cursor.y !== segment.start.y) {
			commands.push(pointCommand('L', segment.start));
		}
		const length = distanceAlong(segment, segment.end);
		const distances = [...(crossings.get(segment) ?? [])]
			.map((point) => distanceAlong(segment, point))
			.filter((distance) => distance >= BRIDGE_RADIUS && distance <= length - BRIDGE_RADIUS)
			.sort((left, right) => left - right);
		let coveredUntil = 0;
		for (const distance of distances) {
			if (distance - BRIDGE_RADIUS < coveredUntil) continue;
			const before = pointAlong(segment, distance - BRIDGE_RADIUS);
			const after = pointAlong(segment, distance + BRIDGE_RADIUS);
			commands.push(pointCommand('L', before));
			commands.push(`A ${BRIDGE_RADIUS} ${BRIDGE_RADIUS} 0 0 1 ${after.x} ${after.y}`);
			coveredUntil = distance + BRIDGE_RADIUS;
		}
		commands.push(pointCommand('L', segment.end));
		cursor = segment.end;
	}
	return commands.join(' ');
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
				const point = intersection(segment, previous);
				if (!point) continue;
				const points = crossings.get(segment) ?? [];
				if (!points.some((candidate) => candidate.x === point.x && candidate.y === point.y)) {
					points.push(point);
					crossings.set(segment, points);
				}
			}
		}
		previousSegments.push(...segments);
		const color = RELATION_COLORS[relationIndex % RELATION_COLORS.length];
		return {
			...relation,
			path: pathFor(segments, crossings),
			color,
		};
	});
}
