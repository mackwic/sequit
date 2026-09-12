import { defined } from '../document/logic-document';
import type { Bounds } from './layout-types';

function commonParents(
	row: readonly string[],
	parents: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
	const first = parents.get(defined(row[0])) ?? [];
	const expected = new Set(first);
	for (const id of row) {
		const adjacent = parents.get(id) ?? [];
		if (adjacent.length !== first.length || adjacent.some((parent) => !expected.has(parent)))
			return [];
	}
	return first;
}

function extent(
	ids: readonly string[],
	bounds: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): { start: number; end: number } {
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const id of ids) {
		const box = defined(bounds.get(id));
		let left = box.y;
		let right = box.y + box.height;
		if (vertical) {
			left = box.x;
			right = box.x + box.width;
		}
		start = Math.min(start, left);
		end = Math.max(end, right);
	}
	return { start, end };
}

function shift(
	ids: readonly string[],
	bounds: Map<string, Bounds>,
	delta: number,
	vertical: boolean,
): void {
	if (delta === 0) return;
	for (const id of ids) {
		const box = defined(bounds.get(id));
		let moved: Bounds;
		if (vertical) moved = { ...box, x: box.x + delta };
		else moved = { ...box, y: box.y + delta };
		bounds.set(id, moved);
	}
}

/** Center a homogeneous branch row on its actual parents, rather than the whole component. */
export function alignRowBranches(input: {
	readonly rows: readonly (readonly string[])[];
	readonly parents: ReadonlyMap<string, readonly string[]>;
	readonly bounds: Map<string, Bounds>;
	readonly vertical: boolean;
}): number {
	const { rows, parents, bounds, vertical } = input;
	for (let rank = 1; rank < rows.length; rank += 1) {
		const row = defined(rows[rank]);
		if (row.length === 0) continue;
		const previous = new Set(rows[rank - 1]);
		const adjacent = commonParents(row, parents);
		if (adjacent.length === 0 || adjacent.some((id) => !previous.has(id))) continue;
		const source = extent(row, bounds, vertical);
		const target = extent(adjacent, bounds, vertical);
		const sourceCenter = (source.start + source.end) / 2;
		const targetCenter = (target.start + target.end) / 2;
		shift(row, bounds, targetCenter - sourceCenter, vertical);
	}
	const ids = [...bounds.keys()];
	const total = extent(ids, bounds, vertical);
	if (ids.length === 0) return 1;
	shift(ids, bounds, -total.start, vertical);
	return total.end - total.start;
}
