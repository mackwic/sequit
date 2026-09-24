import {
	type GridLayoutCell,
	type GridLayoutPresentation,
	GridMinimumField,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import { entries, type MappingContext, rejectUnknownFields, table } from './map-sequit-fields';

const GRID_PATH = ['regionPresentation', 'grid'] as const;

function isUnknownArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function minimum(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		if (value >= 0) return value;
	}
	context.diagnostics.push({
		code: SequitDiagnosticCode.InvalidValue,
		message: 'Grid track minima must be finite nonnegative numbers',
		path,
	});
	return undefined;
}

function minima(
	value: unknown,
	field: GridMinimumField,
	context: MappingContext,
	gridPath: readonly string[],
): readonly number[] | undefined {
	const path = [...gridPath, field];
	if (!isUnknownArray(value) || value.length === 0) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: 'Grid track minima must contain at least one value',
			path,
		});
		return undefined;
	}
	const minima: number[] = [];
	for (const [index, raw] of value.entries()) {
		const mapped = minimum(raw, [...path, String(index)], context);
		if (mapped === undefined) return undefined;
		minima.push(mapped);
	}
	return minima;
}

function position(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): number | undefined {
	const integer = typeof value === 'number' && Number.isSafeInteger(value);
	if (integer && value >= 0) return value;
	context.diagnostics.push({
		code: SequitDiagnosticCode.InvalidValue,
		message: 'Grid coordinate must be a nonnegative integer',
		path,
	});
	return undefined;
}

export function mapGridPresentation(
	value: unknown,
	context: MappingContext,
	gridPath: readonly string[] = GRID_PATH,
): GridLayoutPresentation | undefined {
	const grid = table(value, gridPath, context);
	if (grid === undefined) return undefined;
	rejectUnknownFields(grid, ['minimumColumnWidths', 'minimumRowHeights', 'cells'], gridPath, {
		context,
		description: 'grid presentation',
	});
	const minimumColumnWidths = minima(
		grid[GridMinimumField.ColumnWidths],
		GridMinimumField.ColumnWidths,
		context,
		gridPath,
	);
	const minimumRowHeights = minima(
		grid[GridMinimumField.RowHeights],
		GridMinimumField.RowHeights,
		context,
		gridPath,
	);
	const cellTable = table(grid['cells'], [...gridPath, 'cells'], context);
	if (cellTable === undefined) return undefined;
	const cells: GridLayoutCell[] = [];
	for (const [regionId, value] of entries(cellTable)) {
		const path = [...gridPath, 'cells', regionId];
		const cell = table(value, path, context);
		if (cell === undefined) continue;
		rejectUnknownFields(cell, ['row', 'column'], path, {
			context,
			description: 'grid cell',
		});
		const row = position(cell['row'], [...path, 'row'], context);
		const column = position(cell['column'], [...path, 'column'], context);
		if (row !== undefined && column !== undefined) cells.push({ regionId, row, column });
	}
	if (minimumColumnWidths === undefined || minimumRowHeights === undefined) return undefined;
	return { minimumColumnWidths, minimumRowHeights, cells };
}
