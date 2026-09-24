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

function validMinimum(value: unknown): boolean {
	if (typeof value !== 'number') return false;
	return Number.isFinite(value) && value >= 0;
}

function validateMinimums(
	value: unknown,
	field: GridMinimumField,
	diagnostics: SequitDiagnostic[],
	scope: GridValidationScope,
): void {
	const path = [...scope.path, field];
	if (!isUnknownArray(value) || value.length !== 2) {
		invalid(diagnostics, 'Grid track minima must contain exactly two values', path);
		return;
	}
	for (const [index, minimum] of value.entries())
		if (!validMinimum(minimum))
			invalid(diagnostics, 'Grid track minima must be finite nonnegative numbers', [
				...path,
				String(index),
			]);
}

function validPosition(value: unknown): value is 0 | 1 {
	return value === 0 || value === 1;
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
		invalid(context.diagnostics, 'Grid row must be 0 or 1', [...path, 'row']);
	if (!validPosition(column))
		invalid(context.diagnostics, 'Grid column must be 0 or 1', [...path, 'column']);
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
	if (!isUnknownArray(value) || value.length !== 4) {
		invalid(diagnostics, 'A two by two grid requires exactly four cells', [...scope.path, 'cells']);
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
	validateMinimums(
		grid[GridMinimumField.ColumnWidths],
		GridMinimumField.ColumnWidths,
		diagnostics,
		scope,
	);
	validateMinimums(
		grid[GridMinimumField.RowHeights],
		GridMinimumField.RowHeights,
		diagnostics,
		scope,
	);
	const assigned = validateCells(grid['cells'], regions, diagnostics, scope);
	validateRegions(regions, assigned, diagnostics, scope);
}
