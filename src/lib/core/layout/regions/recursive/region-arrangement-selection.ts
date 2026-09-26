import { gridCellArrangement } from '../../grids/grid-cell-recursive-region';
import { rowRegionArrangement } from '../leaf/region-row-arrangement';
import type { RegionArrangement } from '../model/region-arrangement';
import type { RegionCompositionNode } from '../model/region-composition-tree';

/** A grid owns fixed rails, a childless region is a leaf, every other region is a row. */
export function regionArrangementFor(
	region: RegionCompositionNode,
): RegionArrangement<unknown> | undefined {
	if (region.definition.grid !== undefined) return gridCellArrangement;
	if (region.childIds.length === 0) return undefined;
	return rowRegionArrangement;
}
