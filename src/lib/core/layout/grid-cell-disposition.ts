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
	readonly columnWidths: readonly [number, number];
	readonly rowHeights: readonly [number, number];
	readonly gridRight: number;
	readonly gridBottom: number;
}

function columnExtent(children: readonly SolvedGridCell[], column: 0 | 1, minimum: number): number {
	const demands = children
		.filter(({ cell }) => cell.column === column)
		.map(({ layout }) => layout.width + CELL_PADDING * 2);
	return Math.max(minimum, ...demands);
}

function rowExtent(children: readonly SolvedGridCell[], row: 0 | 1, minimum: number): number {
	const demands = children
		.filter(({ cell }) => cell.row === row)
		.map(({ layout }) => layout.height + CELL_PADDING * 2);
	return Math.max(minimum, ...demands);
}

function cellOrigin(
	cell: GridCellDefinition,
	columnWidths: readonly [number, number],
	rowHeights: readonly [number, number],
	margin: number,
): Point {
	let x = margin;
	let y = margin;
	if (cell.column === 1) x += columnWidths[0] + TRACK_GAP;
	if (cell.row === 1) y += rowHeights[0] + TRACK_GAP;
	return { x, y };
}

/** Place four independently solved children into extensible two by two tracks. */
export function layoutGridCellDisposition(
	children: readonly SolvedGridCell[],
	input: GridCellInput,
	margin: number,
): GridCellDisposition {
	const columnWidths: [number, number] = [
		columnExtent(children, 0, input.minimumColumnWidths[0]),
		columnExtent(children, 1, input.minimumColumnWidths[1]),
	];
	const rowHeights: [number, number] = [
		rowExtent(children, 0, input.minimumRowHeights[0]),
		rowExtent(children, 1, input.minimumRowHeights[1]),
	];
	const gridRight = margin + columnWidths[0] + TRACK_GAP + columnWidths[1];
	const cells: GridCellPlacement[] = children.map(({ cell, layout, ranks }) => {
		const origin = cellOrigin(cell, columnWidths, rowHeights, margin);
		const bounds = {
			x: origin.x,
			y: origin.y,
			width: columnWidths[cell.column],
			height: rowHeights[cell.row],
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
	const gridBottom = margin + rowHeights[0] + TRACK_GAP + rowHeights[1];
	return { cells, columnWidths, rowHeights, gridRight, gridBottom };
}
