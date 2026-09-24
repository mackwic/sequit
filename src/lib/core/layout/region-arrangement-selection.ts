import { gridCellArrangement } from './grid-cell-recursive-region';
import type { RegionArrangement } from './region-arrangement';
import type { RegionCompositionNode } from './region-composition-tree';
import { rowRegionArrangement } from './region-row-arrangement';

/** A grid owns fixed rails, a childless region is a leaf, every other region is a row. */
export function regionArrangementFor(
	region: RegionCompositionNode,
): RegionArrangement<unknown> | undefined {
	if (region.definition.grid !== undefined) return gridCellArrangement;
	if (region.childIds.length === 0) return undefined;
	return rowRegionArrangement;
}
