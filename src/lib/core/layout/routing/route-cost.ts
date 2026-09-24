import { strictCrossing } from '../geometry/strict-crossing';
import type { LayoutRelation, LayoutResult, Point } from '../layout-types';

interface Segment {
	readonly start: Point;
	readonly end: Point;
}

/** The declared cost of one materialized layout: its frame area, route length and bends. */
export interface RouteCost {
	readonly area: number;
	readonly routeLength: number;
	readonly bends: number;
}

function routeLengthAndBends(route: LayoutRelation): { routeLength: number; bends: number } {
	let routeLength = 0;
	let bends = 0;
	let previousHorizontal: boolean | undefined;
	for (let index = 1; index < route.points.length; index += 1) {
		const before = route.points[index - 1];
		const after = route.points[index];
		if (before === undefined || after === undefined) continue;
		const dx = Math.abs(after.x - before.x);
		const dy = Math.abs(after.y - before.y);
		routeLength += dx + dy;
		if (dx === 0 && dy === 0) continue;
		const horizontal = dx > 0;
		if (previousHorizontal !== undefined && previousHorizontal !== horizontal) bends += 1;
		previousHorizontal = horizontal;
	}
	return { routeLength, bends };
}

/**
 * The two costs the detour/bridge policy compares, plus the bends the visual panels report: the
 * frame area and the summed Manhattan length of every route.
 */
export function layoutRouteCost(layout: LayoutResult): RouteCost {
	let routeLength = 0;
	let bends = 0;
	for (const route of layout.relations) {
		const cost = routeLengthAndBends(route);
		routeLength += cost.routeLength;
		bends += cost.bends;
	}
	return { area: layout.width * layout.height, routeLength, bends };
}

function append(lines: Segment[], line: Segment): void {
	const previous = lines.at(-1);
	if (previous !== undefined) {
		const horizontal = previous.start.y === previous.end.y && line.start.y === line.end.y;
		const vertical = previous.start.x === previous.end.x && line.start.x === line.end.x;
		if (horizontal || vertical) {
			lines[lines.length - 1] = { start: previous.start, end: line.end };
			return;
		}
	}
	lines.push(line);
}

function segments(paths: ReadonlyMap<string, readonly Point[]>): Segment[] {
	const result: Segment[] = [];
	for (const points of paths.values()) {
		const lines: Segment[] = [];
		for (let index = 1; index < points.length; index += 1) {
			const start = points[index - 1];
			const end = points[index];
			if (start === undefined || end === undefined) continue;
			if (start.x === end.x && start.y === end.y) continue;
			append(lines, { start, end });
		}
		result.push(...lines);
	}
	return result;
}

/** Count physical crossings once even when several relations share a trunk. */
function crossings(lines: readonly Segment[]): number {
	const positions = new Set<string>();
	for (const horizontal of lines.filter(({ start, end }) => start.y === end.y)) {
		for (const vertical of lines.filter(({ start, end }) => start.x === end.x)) {
			const point = strictCrossing(horizontal.start, horizontal.end, vertical.start, vertical.end);
			if (point === undefined) continue;
			positions.add(`${point.x},${point.y}`);
		}
	}
	return positions.size;
}

export function improvesRoutes(
	before: ReadonlyMap<string, readonly Point[]>,
	after: ReadonlyMap<string, readonly Point[]>,
): boolean {
	const original = segments(before);
	const candidate = segments(after);
	return candidate.length < original.length && crossings(candidate) <= crossings(original);
}
