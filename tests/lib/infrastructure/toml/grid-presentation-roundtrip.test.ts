import { describe, expect, it } from 'vitest';

import {
	GRID_PERSISTENCE_FORMAT,
	GRID_REGION_PRESENTATION_SCHEMA,
	type LogicDocument,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { mapGridPresentation } from '../../../../src/lib/infrastructure/toml/map-grid-presentation';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import {
	persistedGridDocument,
	persistedNxmGridDocument,
} from '../../core/layout/grid-cell-fixture';

function paths(document: LogicDocument): readonly string[] {
	const result = validateLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

function requiredRegionPresentation(
	document: LogicDocument,
): NonNullable<LogicDocument['regionPresentation']> {
	const presentation = document.regionPresentation;
	if (presentation === undefined) throw new Error('Expected region presentation');
	return presentation;
}

function requiredGrid(document: LogicDocument) {
	const presentation = requiredRegionPresentation(document);
	if (presentation.schemaVersion !== GRID_REGION_PRESENTATION_SCHEMA)
		throw new Error('Expected grid presentation');
	return presentation.grid;
}

describe('TOML grid presentation', () => {
	it('round trips four root child regions, slots, minima and endpoint ownership in format 5', () => {
		const source = persistedGridDocument();
		expect(paths(source)).toEqual([]);
		const serialized = serializeSequitToml(source);
		expect(serialized).toContain('persistenceFormat = 5');
		expect(serialized).toContain('[regionPresentation.grid.cells.a]');
		const parsed = parseSequitToml(serialized);
		expect(parsed).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: GRID_PERSISTENCE_FORMAT,
				regionPresentation: {
					schemaVersion: GRID_REGION_PRESENTATION_SCHEMA,
					grid: {
						minimumColumnWidths: [700, 100],
						minimumRowHeights: [50, 300],
						cells: [
							{ regionId: 'a', row: 0, column: 0 },
							{ regionId: 'b', row: 0, column: 1 },
							{ regionId: 'c', row: 1, column: 0 },
							{ regionId: 'd', row: 1, column: 1 },
						],
					},
				},
			},
		});
		if (!parsed.ok) throw new Error('Expected grid document to parse');
		expect(serializeSequitToml(parsed.value)).toBe(serialized);
	});

	it('keeps the format 4 region presentation readable and refuses a grid under format 4', () => {
		const source = persistedGridDocument();
		const legacy: LogicDocument = {
			...source,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_PRESENTATION_SCHEMA,
				regions: source.regionPresentation?.regions ?? [],
			},
		};
		expect(parseSequitToml(serializeSequitToml(legacy))).toMatchObject({ ok: true });
		const wrongFormat = serializeSequitToml(source).replace(
			'persistenceFormat = 5',
			'persistenceFormat = 4',
		);
		const parsed = parseSequitToml(wrongFormat);
		expect(parsed).toMatchObject({ ok: false });
		if (parsed.ok) return;
		expect(parsed.diagnostics.map(({ path }) => path.join('.'))).toContain(
			'regionPresentation.schemaVersion',
		);
	});

	it('diagnoses invalid minima, cell slots, region references and hierarchy', () => {
		const source = persistedGridDocument();
		if (source.regionPresentation?.schemaVersion !== GRID_REGION_PRESENTATION_SCHEMA)
			throw new Error('Expected grid presentation');
		const presentation = source.regionPresentation;
		const badMinima: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				grid: { ...presentation.grid, minimumColumnWidths: [700, -1] },
			},
		};
		expect(paths(badMinima)).toContain('regionPresentation.grid.minimumColumnWidths.1');
		const duplicateSlot: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				grid: {
					...presentation.grid,
					cells: presentation.grid.cells.map((cell) => {
						if (cell.regionId === 'b') return { ...cell, column: 0 };
						return cell;
					}),
				},
			},
		};
		expect(paths(duplicateSlot)).toContain('regionPresentation.grid.cells.b');
		const unknownRegion: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				grid: {
					...presentation.grid,
					cells: presentation.grid.cells.map((cell) => {
						if (cell.regionId === 'b') return { ...cell, regionId: 'absent' };
						return cell;
					}),
				},
			},
		};
		expect(paths(unknownRegion)).toEqual(
			expect.arrayContaining([
				'regionPresentation.grid.cells.absent.regionId',
				'regionPresentation.regions.b',
			]),
		);
		const nestedCell: LogicDocument = {
			...source,
			regionPresentation: {
				...presentation,
				regions: presentation.regions.map((region) => {
					if (region.id === 'd') return { ...region, parentId: 'a' };
					return region;
				}),
			},
		};
		expect(paths(nestedCell)).toContain('regionPresentation.regions.d.parentId');
	});

	it('rejects malformed in-memory grid shapes and duplicate region assignments', () => {
		const source = persistedGridDocument();
		if (source.regionPresentation?.schemaVersion !== GRID_REGION_PRESENTATION_SCHEMA)
			throw new Error('Expected grid presentation');
		const presentation = source.regionPresentation;
		const invalidShapes: readonly {
			readonly mutate: (document: LogicDocument) => void;
			readonly path: string;
		}[] = [
			{
				mutate: (document) => Reflect.set(requiredRegionPresentation(document), 'grid', null),
				path: 'regionPresentation.grid',
			},
			{
				mutate: (document) => Reflect.set(requiredGrid(document), 'cells', []),
				path: 'regionPresentation.grid.cells',
			},
			{
				mutate: (document) => Reflect.set(requiredGrid(document), 'minimumRowHeights', []),
				path: 'regionPresentation.grid.minimumRowHeights',
			},
			{
				mutate: (document) => Reflect.set(requiredGrid(document), 'minimumRowHeights', [50, '300']),
				path: 'regionPresentation.grid.minimumRowHeights.1',
			},
			{
				mutate: (document) => Reflect.set(requiredGrid(document), 'cells', [null, {}, 3, false]),
				path: 'regionPresentation.grid.cells',
			},
			{
				mutate: (document) => Reflect.set(requiredGrid(document), 'cells', 'broken'),
				path: 'regionPresentation.grid.cells',
			},
			{
				mutate: (document) =>
					Reflect.set(requiredGrid(document), 'cells', [
						{ regionId: 'a', row: 0, column: 0 },
						{ regionId: 'b', row: 0, column: 1 },
						{ regionId: 'c', row: 1, column: 0 },
						{ regionId: 'd', row: 1.5, column: 1 },
					]),
				path: 'regionPresentation.grid.cells.d.row',
			},
			{
				mutate: (document) =>
					Reflect.set(requiredGrid(document), 'cells', [
						{ regionId: 'a', row: 0, column: 0 },
						{ regionId: 'a', row: 0, column: 1 },
						{ regionId: 'c', row: 2, column: 0 },
						{ regionId: 'd', row: 1, column: 2 },
					]),
				path: 'regionPresentation.grid.cells.a',
			},
		];
		for (const { mutate, path } of invalidShapes) {
			const document: LogicDocument = {
				...source,
				regionPresentation: { ...presentation, grid: { ...presentation.grid } },
			};
			mutate(document);
			expect(paths(document), path).toContain(path);
		}
	});

	it('maps malformed grid tables to precise source paths', () => {
		const valid = {
			minimumColumnWidths: [700, 100],
			minimumRowHeights: [50, 300],
			cells: { a: { row: 0, column: 0 } },
		};
		const invalidValues: readonly { readonly value: unknown; readonly path: string }[] = [
			{ value: null, path: 'regionPresentation.grid' },
			{
				value: { ...valid, minimumColumnWidths: [] },
				path: 'regionPresentation.grid.minimumColumnWidths',
			},
			{
				value: { ...valid, minimumColumnWidths: ['700', 100] },
				path: 'regionPresentation.grid.minimumColumnWidths.0',
			},
			{
				value: { ...valid, minimumRowHeights: [50, -1] },
				path: 'regionPresentation.grid.minimumRowHeights.1',
			},
			{ value: { ...valid, cells: [] }, path: 'regionPresentation.grid.cells' },
			{
				value: { ...valid, cells: { a: [] } },
				path: 'regionPresentation.grid.cells.a',
			},
			{
				value: { ...valid, cells: { a: { row: '0', column: 0 } } },
				path: 'regionPresentation.grid.cells.a.row',
			},
			{
				value: { ...valid, cells: { a: { row: 0, column: -1 } } },
				path: 'regionPresentation.grid.cells.a.column',
			},
			{
				value: { ...valid, cells: { a: { row: 0, column: 0, extra: true } } },
				path: 'regionPresentation.grid.cells.a.extra',
			},
		];
		for (const { value, path } of invalidValues) {
			const diagnostics: Parameters<typeof mapGridPresentation>[1]['diagnostics'] = [];
			mapGridPresentation(value, { diagnostics });
			expect(
				diagnostics.map((item) => item.path.join('.')),
				path,
			).toContain(path);
		}
	});

	it('round trips a persisted three by two grid and reads the historical schema', () => {
		const source = persistedNxmGridDocument();
		expect(paths(source)).toEqual([]);
		const serialized = serializeSequitToml(source);
		expect(serialized).toContain('persistenceFormat = 5');
		expect(serialized).toContain(`schemaVersion = ${GRID_REGION_PRESENTATION_SCHEMA}`);
		expect(serialized).toContain('[regionPresentation.grid.cells.f]');
		const parsed = parseSequitToml(serialized);
		expect(parsed).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: GRID_PERSISTENCE_FORMAT,
				regionPresentation: {
					grid: {
						minimumColumnWidths: [180, 120, 140],
						minimumRowHeights: [70, 90],
					},
				},
			},
		});
		if (!parsed.ok) throw new Error('Expected the three by two grid to parse');
		expect(
			parsed.value.regionPresentation?.grid?.cells.map(
				({ regionId, row, column }) => `${regionId}:${row}:${column}`,
			),
		).toEqual(['a:0:0', 'b:0:1', 'c:0:2', 'd:1:0', 'e:1:1', 'f:1:2']);
		expect(parseSequitToml(serializeSequitToml(parsed.value))).toEqual(parsed);
		const historical = serialized.replace(
			`schemaVersion = ${GRID_REGION_PRESENTATION_SCHEMA}`,
			'schemaVersion = 2',
		);
		const migrated = parseSequitToml(historical);
		expect(migrated).toMatchObject({
			ok: true,
			value: { regionPresentation: { schemaVersion: GRID_REGION_PRESENTATION_SCHEMA } },
		});
		if (!migrated.ok) throw new Error('Expected the historical grid schema to parse');
		expect(serializeSequitToml(migrated.value)).toContain(
			`schemaVersion = ${GRID_REGION_PRESENTATION_SCHEMA}`,
		);
	});
});
