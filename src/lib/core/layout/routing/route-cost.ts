import { strictCrossing } from '../geometry/strict-crossing';
import type { Point } from '../layout-types';

interface Segment {
	readonly start: Point;
	readonly end: Point;
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
