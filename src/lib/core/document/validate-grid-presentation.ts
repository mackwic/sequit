import { compareCanonicalStrings } from '../canonical-string';
import {
	GridMinimumField,
	type LayoutRegionDefinition,
	type SequitDiagnostic,
	SequitDiagnosticCode,
} from './logic-document';
import { ROOT_LAYOUT_REGION_ID } from './region-presentation';

const GRID_PATH = ['regionPresentation', 'grid'] as const;

interface GridValidationScope {
	readonly path: readonly string[];
	/** Omission preserves the format 5 grid at the virtual root. */
	readonly parentId?: string;
}

const ROOT_SCOPE: GridValidationScope = { path: GRID_PATH };

function invalid(diagnostics: SequitDiagnostic[], message: string, path: readonly string[]): void {
	diagnostics.push({ code: SequitDiagnosticCode.InvalidValue, message, path });
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function validMinimum(value: unknown): value is number {
	if (typeof value !== 'number') return false;
	return Number.isFinite(value) && value >= 0;
}

function validateMinimums(
	value: unknown,
	field: GridMinimumField,
	diagnostics: SequitDiagnostic[],
	scope: GridValidationScope,
): readonly number[] | undefined {
	const path = [...scope.path, field];
	if (!isUnknownArray(value) || value.length === 0) {
		invalid(diagnostics, 'Grid track minima must contain at least one value', path);
		return undefined;
	}
	const minima: number[] = [];
	for (const [index, minimum] of value.entries()) {
		if (!validMinimum(minimum)) {
			invalid(diagnostics, 'Grid track minima must be finite nonnegative numbers', [
				...path,
				String(index),
			]);
			return undefined;
		}
		minima.push(minimum);
	}
	return minima;
}

function validPosition(value: unknown): value is number {
	if (typeof value !== 'number') return false;
	return Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== 'object') return false;
	if (value === null) return false;
	return !Array.isArray(value);
}

function cellIdentity(value: unknown): string {
	if (!isRecord(value)) return '';
	const id = value['regionId'];
	if (typeof id !== 'string') return '';
	return id;
}

interface CellValidationContext {
	readonly regionIds: ReadonlySet<string>;
	readonly assigned: Set<string>;
	readonly slots: Set<string>;
	readonly diagnostics: SequitDiagnostic[];
	readonly scope: GridValidationScope;
}

function validateCell(value: unknown, context: CellValidationContext): void {
	if (!isRecord(value)) {
		invalid(context.diagnostics, 'Grid cell must be an object', [...context.scope.path, 'cells']);
		return;
	}
	const regionId = cellIdentity(value);
	const path = [...context.scope.path, 'cells', regionId];
	const present = regionId.trim() !== '' && context.regionIds.has(regionId);
	if (!present) {
		let message = 'Grid cell must reference an existing region';
		if (context.scope.parentId !== undefined)
			message = 'Grid cell must reference a direct child region';
		invalid(context.diagnostics, message, [...path, 'regionId']);
	}
	if (context.assigned.has(regionId))
		invalid(context.diagnostics, 'Grid region is assigned to more than one cell', path);
	context.assigned.add(regionId);
	const row = value['row'];
	const column = value['column'];
	if (!validPosition(row))
		invalid(context.diagnostics, 'Grid row must be a nonnegative integer', [...path, 'row']);
	if (!validPosition(column))
		invalid(context.diagnostics, 'Grid column must be a nonnegative integer', [...path, 'column']);
	if (!validPosition(row) || !validPosition(column)) return;
	const slot = `${row}:${column}`;
	if (context.slots.has(slot))
		invalid(context.diagnostics, 'Grid slot is occupied by more than one region', path);
	context.slots.add(slot);
}

function validateCells(
	value: unknown,
	regions: readonly LayoutRegionDefinition[],
	diagnostics: SequitDiagnostic[],
	scope: GridValidationScope,
): ReadonlySet<string> {
	const assigned = new Set<string>();
	if (!isUnknownArray(value) || value.length === 0) {
		invalid(diagnostics, 'A grid requires at least one cell', [...scope.path, 'cells']);
		return assigned;
	}
	let eligible = regions;
	if (scope.parentId !== undefined)
		eligible = regions.filter(({ parentId }) => parentId === scope.parentId);
	const context: CellValidationContext = {
		regionIds: new Set(eligible.map(({ id }) => id)),
		assigned,
		slots: new Set<string>(),
		diagnostics,
		scope,
	};
	for (const cell of [...value].sort((left, right) =>
		compareCanonicalStrings(cellIdentity(left), cellIdentity(right)),
	))
		validateCell(cell, context);
	return assigned;
}

/** The cells must cover exactly the rectangle the two minima arrays describe. */
function validateRectangle(
	value: unknown,
	minima: readonly [readonly number[] | undefined, readonly number[] | undefined],
	diagnostics: SequitDiagnostic[],
	scope: GridValidationScope,
): void {
	const [columnWidths, rowHeights] = minima;
	if (columnWidths === undefined || rowHeights === undefined) return;
	const path = [...scope.path, 'cells'];
	if (!isUnknownArray(value)) {
		invalid(diagnostics, 'Grid cells must cover exactly one cell rectangle', path);
		return;
	}
	const rows = new Set<number>();
	const columns = new Set<number>();
	for (const cell of value) {
		if (!isRecord(cell)) return;
		const row = cell['row'];
		const column = cell['column'];
		if (!validPosition(row) || !validPosition(column)) return;
		rows.add(row);
		columns.add(column);
	}
	const sized = rows.size === rowHeights.length && columns.size === columnWidths.length;
	const tiled = value.length === rowHeights.length * columnWidths.length;
	const rowsOrdered = Math.max(...rows) === rows.size - 1;
	const columnsOrdered = Math.max(...columns) === columns.size - 1;
	const covers = sized && tiled && rowsOrdered && columnsOrdered;
	if (!covers) invalid(diagnostics, 'Grid cells must cover exactly one cell rectangle', path);
}

function validateRegions(
	regions: readonly LayoutRegionDefinition[],
	assigned: ReadonlySet<string>,
	diagnostics: SequitDiagnostic[],
	scope: GridValidationScope,
): void {
	for (const region of [...regions].sort((left, right) =>
		compareCanonicalStrings(left.id, right.id),
	)) {
		if (scope.parentId !== undefined && region.parentId !== scope.parentId) continue;
		const nested = region.parentId !== undefined && region.parentId !== ROOT_LAYOUT_REGION_ID;
		if (nested && scope.parentId === undefined)
			invalid(diagnostics, 'Grid cells must be direct children of the root region', [
				'regionPresentation',
				'regions',
				region.id,
				'parentId',
			]);
		if (!assigned.has(region.id)) {
			let message = 'Every grid region must occupy one cell';
			if (scope.parentId !== undefined)
				message = 'Every direct child of a grid region must occupy one cell';
			invalid(diagnostics, message, ['regionPresentation', 'regions', region.id]);
		}
	}
}

/** Validate the persisted grid contract; solver envelope checks remain in the layout policy. */
export function validateGridPresentation(
	grid: unknown,
	regions: readonly LayoutRegionDefinition[],
	diagnostics: SequitDiagnostic[],
	scope: GridValidationScope = ROOT_SCOPE,
): void {
	if (!isRecord(grid)) {
		invalid(diagnostics, 'Grid presentation must be an object', scope.path);
		return;
	}
	const columnWidths = validateMinimums(
		grid[GridMinimumField.ColumnWidths],
		GridMinimumField.ColumnWidths,
		diagnostics,
		scope,
	);
	const rowHeights = validateMinimums(
		grid[GridMinimumField.RowHeights],
		GridMinimumField.RowHeights,
		diagnostics,
		scope,
	);
	const assigned = validateCells(grid['cells'], regions, diagnostics, scope);
	validateRectangle(grid['cells'], [columnWidths, rowHeights], diagnostics, scope);
	validateRegions(regions, assigned, diagnostics, scope);
}
