import * as Y from 'yjs';

import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	type GridLayoutCell,
	type GridLayoutPresentation,
	GridMinimumField,
} from '../../core/document/logic-document';
import { readCollection } from './yjs-document-presentation';
import { type ReadContext, YjsLiveDocumentDiagnosticCode } from './yjs-document-result';
import { YjsCollection } from './yjs-document-schema';

function invalid(context: ReadContext, message: string, path: readonly string[]): void {
	context.diagnostics.push({ code: YjsLiveDocumentDiagnosticCode.Invalid, message, path });
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function readMinimum(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		if (value >= 0) return value;
	}
	invalid(context, 'Grid track minima must be finite nonnegative numbers', path);
	return undefined;
}

function readMinimums(
	value: unknown,
	field: GridMinimumField,
	gridPath: readonly string[],
	context: ReadContext,
): readonly [number, number] | undefined {
	const path = [...gridPath, field];
	if (!isUnknownArray(value) || value.length !== 2) {
		invalid(context, 'Grid track minima must contain exactly two values', path);
		return undefined;
	}
	const first = readMinimum(value[0], [...path, '0'], context);
	const second = readMinimum(value[1], [...path, '1'], context);
	if (first === undefined || second === undefined) return undefined;
	return [first, second];
}

function readPosition(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): 0 | 1 | undefined {
	if (value === 0 || value === 1) return value;
	invalid(context, 'Grid coordinate must be 0 or 1', path);
	return undefined;
}

function readCell(
	entity: Y.Map<unknown>,
	regionId: string,
	gridPath: readonly string[],
	context: ReadContext,
): GridLayoutCell | undefined {
	const path = [...gridPath, 'cells', regionId];
	const row = readPosition(entity.get('row'), [...path, 'row'], context);
	const column = readPosition(entity.get('column'), [...path, 'column'], context);
	if (row === undefined || column === undefined) return undefined;
	return { regionId, row, column };
}

export function readGridPresentation(
	ydoc: Y.Doc,
	meta: Y.Map<unknown>,
	context: ReadContext,
): GridLayoutPresentation | undefined {
	const gridPath = ['regionPresentation', 'grid'];
	const minimumColumnWidths = readMinimums(
		meta.get('gridMinimumColumnWidths'),
		GridMinimumField.ColumnWidths,
		gridPath,
		context,
	);
	const minimumRowHeights = readMinimums(
		meta.get('gridMinimumRowHeights'),
		GridMinimumField.RowHeights,
		gridPath,
		context,
	);
	const cells = readCollection(ydoc, context, {
		sharedName: YjsCollection.GridCells,
		collectionName: 'regionPresentation.grid.cells',
		project: (entity, id) => readCell(entity, id, gridPath, context),
	});
	if (minimumColumnWidths === undefined || minimumRowHeights === undefined) return undefined;
	return { minimumColumnWidths, minimumRowHeights, cells };
}

export function readRegionGridPresentation(
	value: unknown,
	regionId: string,
	context: ReadContext,
): GridLayoutPresentation | undefined {
	const gridPath = ['regionPresentation', 'regions', regionId, 'grid'];
	if (!(value instanceof Y.Map)) {
		invalid(context, 'Region grid must be a Y.Map', gridPath);
		return undefined;
	}
	const minimumColumnWidths = readMinimums(
		value.get(GridMinimumField.ColumnWidths),
		GridMinimumField.ColumnWidths,
		gridPath,
		context,
	);
	const minimumRowHeights = readMinimums(
		value.get(GridMinimumField.RowHeights),
		GridMinimumField.RowHeights,
		gridPath,
		context,
	);
	const cellsValue: unknown = value.get('cells');
	const cells: GridLayoutCell[] = [];
	if (!(cellsValue instanceof Y.Map))
		invalid(context, 'Region grid cells must be a Y.Map', [...gridPath, 'cells']);
	else
		for (const childId of [...cellsValue.keys()].sort(compareCanonicalStrings)) {
			const cell: unknown = cellsValue.get(childId);
			if (!(cell instanceof Y.Map)) {
				invalid(context, 'Region grid cell must be a Y.Map', [...gridPath, 'cells', childId]);
				continue;
			}
			const read = readCell(cell, childId, gridPath, context);
			if (read !== undefined) cells.push(read);
		}
	if (minimumColumnWidths === undefined || minimumRowHeights === undefined) return undefined;
	if (!(cellsValue instanceof Y.Map)) return undefined;
	return { minimumColumnWidths, minimumRowHeights, cells };
}

export function rejectGridPresentation(
	ydoc: Y.Doc,
	meta: Y.Map<unknown>,
	context: ReadContext,
): void {
	const hasGrid =
		meta.has('gridMinimumColumnWidths') ||
		meta.has('gridMinimumRowHeights') ||
		ydoc.getMap(YjsCollection.GridCells).size > 0;
	if (hasGrid)
		invalid(context, 'This shared format cannot persist a grid presentation', [
			'regionPresentation',
			'grid',
		]);
}
