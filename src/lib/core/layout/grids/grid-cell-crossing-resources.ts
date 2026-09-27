import { compareCanonicalStrings } from '../../canonical-string';
import { defined, type LogicRelation } from '../../document/logic-document';
import { type RoutingEdge, trackOffset } from '../resources/routing-resource-allocation';
import {
	CROSSING_SPACING,
	GRID_GUTTER_MIN_MARGIN,
	type GridRoutingEdges,
	gridRoutingEdges,
} from './grid-cell-crossing';
import type { GridCellInput } from './grid-cell-types';

export interface GridCrossingResources {
	readonly edges: GridRoutingEdges;
	readonly gutterIds: readonly (readonly string[])[];
	readonly rowGutterIds: readonly (readonly string[])[];
}

/** Crossings owned by this grid charge only the columns of their endpoints, never intervening
 * columns. Compute this before placement so that frame and route allocation share the resources. */
export function gridCrossingResources(
	input: GridCellInput,
	crossing: readonly LogicRelation[],
): GridCrossingResources {
	const columnByCellId = new Map(input.cells.map(({ id, column }) => [id, column]));
	const rowByCellId = new Map(input.cells.map(({ id, row }) => [id, row]));
	const rowGutterIds = Array.from(
		{ length: input.minimumRowHeights.length - 1 },
		() => [] as string[],
	);
	const gutterIds = Array.from({ length: input.minimumColumnWidths.length }, () => [] as string[]);
	for (const { id, from, to } of crossing) {
		const source = defined(columnByCellId.get(defined(input.cellByEndpointId.get(from))));
		const target = defined(columnByCellId.get(defined(input.cellByEndpointId.get(to))));
		defined(gutterIds[source]).push(id);
		if (source !== target) defined(gutterIds[target]).push(id);
		const sourceRow = defined(rowByCellId.get(defined(input.cellByEndpointId.get(from))));
		const targetRow = defined(rowByCellId.get(defined(input.cellByEndpointId.get(to))));
		if (source !== target && sourceRow !== targetRow)
			for (let row = Math.min(sourceRow, targetRow); row < Math.max(sourceRow, targetRow); row += 1)
				defined(rowGutterIds[row]).push(id);
	}
	for (const ids of [...gutterIds, ...rowGutterIds]) ids.sort(compareCanonicalStrings);
	return {
		edges: gridRoutingEdges(input.rootId, gutterIds, crossing.length, rowGutterIds),
		gutterIds,
		rowGutterIds,
	};
}

/** The row gap reserves a track at least 48px below the upper cells and above the next row. */
export function gridRowGap(edge: RoutingEdge): number {
	return GRID_GUTTER_MIN_MARGIN + CROSSING_SPACING * Math.max(0, edge.capacity - 1);
}

/** The y coordinate of an allocated horizontal row track. */
export function crossingRowY(edge: RoutingEdge, upperRowBottom: number, track: number): number {
	const anchor = GRID_GUTTER_MIN_MARGIN / 2 - CROSSING_SPACING;
	return upperRowBottom + anchor + trackOffset(edge, track);
}
