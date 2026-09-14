import { defined } from '../../document/logic-document';
import {
	type MutableBounds,
	translateTransversely,
	transverseCenter,
	transverseSize,
} from '../geometry/layout-frame';
import type { BranchAnchor } from '../structure/branch-anchors';
import { fitRowAnchors, type RowAnchorItem } from './fit-row-anchors';

export interface BranchAlignment {
	readonly anchors: ReadonlyMap<string, BranchAnchor>;
	readonly offsets?: ReadonlyMap<string, number> | undefined;
}

interface PreferredAnchor {
	readonly index: number;
	readonly target: number;
	readonly distance: number;
}

/** Choose a straight spine for each family, then fit the row without changing its order. */
export function alignMixedRow(input: {
	readonly row: readonly string[];
	readonly bounds: ReadonlyMap<string, MutableBounds>;
	readonly vertical: boolean;
	readonly alignment: BranchAlignment;
}): void {
	const { row, bounds, vertical, alignment } = input;
	const preferred = new Map<string, PreferredAnchor>();
	const items: RowAnchorItem[] = row.map((id) => {
		const box = defined(bounds.get(id));
		return {
			center: transverseCenter(box, vertical),
			size: transverseSize(box, vertical),
			fixed: !alignment.anchors.has(id),
		};
	});
	for (const [index, id] of row.entries()) {
		const anchor = alignment.anchors.get(id);
		if (anchor === undefined) continue;
		const parent = defined(bounds.get(anchor.parentId));
		const target = transverseCenter(parent, vertical) + (alignment.offsets?.get(id) ?? 0);
		const distance = Math.abs(target - defined(items[index]).center);
		const previous = preferred.get(anchor.parentId);
		if (previous === undefined || distance < previous.distance)
			preferred.set(anchor.parentId, { index, target, distance });
	}
	for (const { index, target } of preferred.values())
		items[index] = { ...defined(items[index]), target };
	const centers = fitRowAnchors(items);
	for (const [index, id] of row.entries())
		translateTransversely(
			defined(bounds.get(id)),
			defined(centers[index]) - defined(items[index]).center,
			vertical,
		);
}
