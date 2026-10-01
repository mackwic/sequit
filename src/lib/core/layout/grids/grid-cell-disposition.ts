import { defined } from '../../document/logic-document';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import type { LayoutResult } from '../layout-types';
import { gridGutterMargin, gridMargin, type GridRoutingEdges } from './grid-cell-crossing';
import { gridRowGap } from './grid-cell-crossing-resources';
import type { GridCellDefinition, GridCellInput, GridCellPlacement } from './grid-cell-types';

const CELL_PADDING = 32;
const EMPTY_CELL_MIN_SIZE = CELL_PADDING * 2;
const TRACK_GAP = 96;

export interface SolvedGridCell {
	readonly cell: GridCellDefinition;
	readonly ranks: TopologicalRanks;
	readonly layout: LayoutResult;
}

export interface GridCellDisposition {
	readonly cells: readonly GridCellPlacement[];
	readonly columnWidths: readonly number[];
	readonly rowHeights: readonly number[];
	readonly gridRight: number;
	readonly gridBottom: number;
}

function columnExtent(
	children: readonly SolvedGridCell[],
	column: number,
	minimum: number,
): number {
	const demands = children
		.filter(({ cell }) => cell.column === column)
		.map(({ layout }) => {
			if (layout.elements.length === 0) return EMPTY_CELL_MIN_SIZE;
			return layout.width + CELL_PADDING * 2;
		});
	return Math.max(minimum, ...demands);
}

function rowExtent(children: readonly SolvedGridCell[], row: number, minimum: number): number {
	const demands = children
		.filter(({ cell }) => cell.row === row)
		.map(({ layout }) => {
			if (layout.elements.length === 0) return EMPTY_CELL_MIN_SIZE;
			return layout.height + CELL_PADDING * 2;
		});
	return Math.max(minimum, ...demands);
}

/** The gap before an inner column carries that column's gutter. */
function columnGap(column: number, edges: GridRoutingEdges): number {
	if (column + 1 < edges.gutters.length - 1)
		return Math.max(TRACK_GAP, gridGutterMargin(defined(edges.gutters[column + 1])));
	return TRACK_GAP;
}

/** Place solved children into extensible column and row tracks. */
export function layoutGridCellDisposition(
	children: readonly SolvedGridCell[],
	input: GridCellInput,
	edges: GridRoutingEdges,
): GridCellDisposition {
	const columnWidths = input.minimumColumnWidths.map((minimum, column) =>
		columnExtent(children, column, minimum),
	);
	const rowHeights = input.minimumRowHeights.map((minimum, row) =>
		rowExtent(children, row, minimum),
	);
	const columnOrigins: number[] = [];
	let gridRight = gridGutterMargin(defined(edges.gutters[0]));
	for (const [column, width] of columnWidths.entries()) {
		columnOrigins.push(gridRight);
		gridRight += width;
		if (column + 1 < columnWidths.length) gridRight += columnGap(column, edges);
	}
	const rowOrigins: number[] = [];
	let gridBottom = gridMargin(edges);
	for (const [row, height] of rowHeights.entries()) {
		rowOrigins.push(gridBottom);
		gridBottom += height;
		if (row + 1 < rowHeights.length)
			gridBottom += Math.max(TRACK_GAP, gridRowGap(defined(edges.rowGutters[row])));
	}
	const cells: GridCellPlacement[] = children.map(({ cell, layout, ranks }) => {
		const origin = { x: defined(columnOrigins[cell.column]), y: defined(rowOrigins[cell.row]) };
		const bounds = {
			x: origin.x,
			y: origin.y,
			width: defined(columnWidths[cell.column]),
			height: defined(rowHeights[cell.row]),
		};
		return {
			id: cell.id,
			parentId: input.rootId,
			row: cell.row,
			column: cell.column,
			bounds,
			translation: { x: bounds.x + CELL_PADDING, y: bounds.y + CELL_PADDING },
			localLayout: layout,
			localRanks: ranks,
		};
	});
	return { cells, columnWidths, rowHeights, gridRight, gridBottom };
}
