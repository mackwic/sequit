import { defined } from '../../document/logic-document';
import { transverseEnvelope } from '../geometry/envelope';
import { type MutableBounds, translateTransversely } from '../geometry/layout-frame';

function commonParents(
	row: readonly string[],
	parents: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
	const first = parents.get(defined(row[0])) ?? [];
	const expected = new Set(first);
	for (const id of row) {
		const adjacent = parents.get(id) ?? [];
		if (adjacent === first) continue;
		if (adjacent.length !== first.length || adjacent.some((parent) => !expected.has(parent)))
			return [];
	}
	return first;
}

/** Center a homogeneous branch row on its actual parents, rather than the whole component. */
export function centerRelatedRows(input: {
	readonly rows: readonly (readonly string[])[];
	readonly parents: ReadonlyMap<string, readonly string[]>;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
}): number {
	const { rows, parents, bounds, vertical } = input;
	for (let rank = 1; rank < rows.length; rank += 1) {
		const row = defined(rows[rank]);
		if (row.length === 0) continue;
		const previous = new Set(rows[rank - 1]);
		const adjacent = commonParents(row, parents);
		if (adjacent.length === 0 || adjacent.some((id) => !previous.has(id))) continue;
		const source = transverseEnvelope(row, bounds, vertical);
		const target = transverseEnvelope(adjacent, bounds, vertical);
		const sourceCenter = (source.start + source.end) / 2;
		const targetCenter = (target.start + target.end) / 2;
		for (const id of row)
			translateTransversely(defined(bounds.get(id)), targetCenter - sourceCenter, vertical);
	}
	const ids = [...bounds.keys()];
	const total = transverseEnvelope(ids, bounds, vertical);
	if (ids.length === 0) return 1;
	for (const box of bounds.values()) translateTransversely(box, -total.start, vertical);
	return total.end - total.start;
}
