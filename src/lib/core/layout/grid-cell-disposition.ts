import { defined } from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { GridCellDefinition, GridCellInput, GridCellPlacement } from './grid-cell-types';
import type { LayoutResult, Point } from './layout-types';

const CELL_PADDING = 32;
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
		.map(({ layout }) => layout.width + CELL_PADDING * 2);
	return Math.max(minimum, ...demands);
}

function rowExtent(children: readonly SolvedGridCell[], row: number, minimum: number): number {
	const demands = children
		.filter(({ cell }) => cell.row === row)
		.map(({ layout }) => layout.height + CELL_PADDING * 2);
	return Math.max(minimum, ...demands);
}

/**
 * The gap after column `column` hosts the gutter of column `column + 1`. A gutter between two
 * columns reserves the same clearance as the frame margin; the last gutters sit on the frame.
 */
function columnGap(column: number, columnCount: number, margin: number): number {
	if (column + 1 < columnCount - 1) return Math.max(TRACK_GAP, margin);
	return TRACK_GAP;
}

function cellOrigin(
	cell: GridCellDefinition,
	columnWidths: readonly number[],
	rowHeights: readonly number[],
	margin: number,
): Point {
	let x = margin;
	for (let column = 0; column < cell.column; column += 1)
		x += defined(columnWidths[column]) + columnGap(column, columnWidths.length, margin);
	let y = margin;
	for (let row = 0; row < cell.row; row += 1) y += defined(rowHeights[row]) + TRACK_GAP;
	return { x, y };
}

/** Place solved children into extensible column and row tracks. */
export function layoutGridCellDisposition(
	children: readonly SolvedGridCell[],
	input: GridCellInput,
	margin: number,
): GridCellDisposition {
	const columnWidths = input.minimumColumnWidths.map((minimum, column) =>
		columnExtent(children, column, minimum),
	);
	const rowHeights = input.minimumRowHeights.map((minimum, row) =>
		rowExtent(children, row, minimum),
	);
	let gridRight = margin;
	for (const [column, width] of columnWidths.entries()) {
		gridRight += width;
		if (column + 1 < columnWidths.length)
			gridRight += columnGap(column, columnWidths.length, margin);
	}
	const cells: GridCellPlacement[] = children.map(({ cell, layout, ranks }) => {
		const origin = cellOrigin(cell, columnWidths, rowHeights, margin);
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
	const rowTotal = rowHeights.reduce((total, height) => total + height, 0);
	const rowGaps = TRACK_GAP * Math.max(0, rowHeights.length - 1);
	const gridBottom = margin + rowTotal + rowGaps;
	return { cells, columnWidths, rowHeights, gridRight, gridBottom };
}
