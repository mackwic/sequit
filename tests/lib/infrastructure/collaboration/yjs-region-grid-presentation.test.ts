import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { nodeCreation } from '../../../../src/app/web/document/document-commands';
import { attachLocalDocumentSession } from '../../../../src/app/web/document/local-document-session';
import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	LayoutPolicy,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_POLICY_PERSISTENCE_FORMAT,
	REGION_POLICY_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { reconcileSharedDocument } from '../../../../src/lib/infrastructure/collaboration/reconcile-shared-document';
import {
	importLogicDocument,
	readLogicDocument,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YJS_REGION_POLICY_DOCUMENT_FORMAT,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { regionLaneDocument } from '../../../support/builders/region-lane-document';
import { persistedGridDocument } from '../../core/layout/grid-cell-fixture';

function compositionGridDocument(): LogicDocument {
	const source = persistedGridDocument();
	const presentation = source.regionPresentation;
	if (presentation?.grid === undefined) throw new Error('Expected root grid fixture');
	return {
		...source,
		persistenceFormat: REGION_COMPOSITION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
			regions: [
				{
					id: 'grid',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
					grid: presentation.grid,
				},
				...presentation.regions.map((region) => ({ ...region, parentId: 'grid' })),
			],
		},
		nodes: source.nodes.map((node) => {
			if (node.id === 'a-top') return { ...node, markdown: 'PRIVATE_MARKDOWN_SENTINEL' };
			return node;
		}),
	};
}

function previousRegionDocument(source: LogicDocument): LogicDocument {
	const presentation = source.regionPresentation;
	if (presentation === undefined) throw new Error('Expected region presentation');
	return {
		...source,
		persistenceFormat: REGION_LANE_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
			regions: presentation.regions.map((region) => {
				const previous = { ...region };
				Reflect.deleteProperty(previous, 'grid');
				return previous;
			}),
		},
	};
}

function restored(source: LogicDocument): Y.Doc {
	const original = new Y.Doc();
	importLogicDocument(original, source);
	const replica = new Y.Doc();
	Y.applyUpdate(replica, Y.encodeStateAsUpdate(original));
	original.destroy();
	return replica;
}

function diagnostics(
	document: Y.Doc,
): readonly { readonly path: readonly string[]; readonly message: string }[] {
	const result = readLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics;
}

function paths(document: Y.Doc): readonly string[] {
	return diagnostics(document).map(({ path }) => path.join('.'));
}

function regionGrid(document: Y.Doc): Y.Map<unknown> {
	const grid = document.getMap<Y.Map<unknown>>(YjsCollection.RegionGrids).get('grid');
	if (!(grid instanceof Y.Map)) throw new Error('Expected shared region grid');
	return grid;
}

function gridCells(document: Y.Doc): Y.Map<unknown> {
	const cells = regionGrid(document).get('cells');
	if (!(cells instanceof Y.Map)) throw new Error('Expected shared region grid cells');
	return cells;
}

function gridCell(document: Y.Doc, id: string): Y.Map<unknown> {
	const cell = gridCells(document).get(id);
	if (!(cell instanceof Y.Map)) throw new Error(`Expected shared region grid cell ${id}`);
	return cell;
}

describe('Yjs region grid presentation', () => {
	it('migrates format 7 grid geometry through live format 8, then writes format 9', () => {
		const source = compositionGridDocument();
		const document = restored(source);
		const meta = document.getMap(YjsCollection.Meta);
		expect(meta.get('yjsLiveDocumentFormat')).toBe(YJS_REGION_COMPOSITION_DOCUMENT_FORMAT);
		expect(meta.get('persistenceFormat')).toBe(REGION_COMPOSITION_PERSISTENCE_FORMAT);
		expect(meta.get('regionPresentationSchema')).toBe(REGION_COMPOSITION_PRESENTATION_SCHEMA);
		expect(document.getMap(YjsCollection.GridCells).size).toBe(0);
		expect(document.getMap(YjsCollection.RegionGrids).size).toBe(1);
		expect(gridCells(document).size).toBe(4);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error('Expected valid region grid document');
		expect(result.value.persistenceFormat).toBe(REGION_POLICY_PERSISTENCE_FORMAT);
		expect(result.value.regionPresentation).toEqual({
			schemaVersion: REGION_POLICY_PRESENTATION_SCHEMA,
			regions: [...(source.regionPresentation?.regions ?? [])].sort((left, right) =>
				compareCanonicalStrings(left.id, right.id),
			),
		});
		expect(result.value.nodes.find(({ id }) => id === 'a-top')?.markdown).toBe(
			'PRIVATE_MARKDOWN_SENTINEL',
		);
		const upgraded = restored(result.value);
		expect(upgraded.getMap(YjsCollection.Meta).get('yjsLiveDocumentFormat')).toBe(
			YJS_REGION_POLICY_DOCUMENT_FORMAT,
		);
		expect(upgraded.getMap(YjsCollection.Meta).get('regionPresentationSchema')).toBe(
			REGION_POLICY_PRESENTATION_SCHEMA,
		);
		expect(gridCells(upgraded).size).toBe(4);
		expect(readLogicDocument(upgraded)).toEqual(result);
		upgraded.destroy();
		document.destroy();
	});

	it('rejects a grid schema on a live policy document', () => {
		const document = restored(compositionGridDocument());
		const migrated = readLogicDocument(document);
		if (!migrated.ok) throw new Error('Expected the composition document to migrate');
		const policy = restored(migrated.value);
		policy.getMap(YjsCollection.Meta).set('regionPresentationSchema', 6);
		expect(paths(policy)).toContain('regionPresentation.schemaVersion');
		policy.destroy();
		document.destroy();
	});

	it('reconciles 7 to 8 to 7 in place and preserves shared entity and text identities', () => {
		const source = compositionGridDocument();
		const previous = previousRegionDocument(source);
		const document = restored(previous);
		const meta = document.getMap(YjsCollection.Meta);
		const title = meta.get('title');
		const markdown = document
			.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
			.get('a-top')
			?.get('markdown');
		const region = document.getMap<Y.Map<unknown>>(YjsCollection.Regions).get('grid');
		expect(meta.get('yjsLiveDocumentFormat')).toBe(YJS_REGION_LANE_DOCUMENT_FORMAT);
		reconcileSharedDocument(document, source, 'upgrade');
		expect(meta.get('title')).toBe(title);
		expect(document.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('a-top')?.get('markdown')).toBe(
			markdown,
		);
		expect(document.getMap<Y.Map<unknown>>(YjsCollection.Regions).get('grid')).toBe(region);
		const grid = regionGrid(document);
		const cells = gridCells(document);
		const a = cells.get('a');
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const changed: LogicDocument = {
			...source,
			regionPresentation: {
				schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
				regions: presentation.regions.map((definition) => {
					if (definition.id !== 'grid' || definition.grid === undefined) return definition;
					return {
						...definition,
						grid: {
							...definition.grid,
							minimumColumnWidths: [900, 100] as const,
							cells: definition.grid.cells.map((cell) => {
								if (cell.regionId === 'a') return { ...cell, column: 1 as const };
								if (cell.regionId === 'b') return { ...cell, column: 0 as const };
								return cell;
							}),
						},
					};
				}),
			},
		};
		reconcileSharedDocument(document, changed, 'grid edit');
		expect(regionGrid(document)).toBe(grid);
		expect(gridCells(document)).toBe(cells);
		expect(gridCells(document).get('a')).toBe(a);
		expect(paths(document)).toEqual([]);
		reconcileSharedDocument(document, previous, 'downgrade');
		expect(meta.get('yjsLiveDocumentFormat')).toBe(YJS_REGION_LANE_DOCUMENT_FORMAT);
		expect(meta.get('title')).toBe(title);
		expect(document.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('a-top')?.get('markdown')).toBe(
			markdown,
		);
		expect(document.getMap<Y.Map<unknown>>(YjsCollection.Regions).get('grid')).toBe(region);
		expect(document.getMap(YjsCollection.RegionGrids).size).toBe(0);
		expect(paths(document)).toEqual([]);
		document.destroy();
	});

	it('replaces one grid child while preserving the grid and unchanged cell maps', () => {
		const source = compositionGridDocument();
		const presentation = source.regionPresentation;
		if (presentation === undefined) throw new Error('Expected region presentation');
		const changed: LogicDocument = {
			...source,
			regionPresentation: {
				schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
				regions: presentation.regions.map((region) => {
					if (region.id === 'd') return { ...region, id: 'e' };
					if (region.id !== 'grid' || region.grid === undefined) return region;
					return {
						...region,
						grid: {
							...region.grid,
							cells: region.grid.cells.map((cell) => {
								if (cell.regionId !== 'd') return cell;
								return { ...cell, regionId: 'e' };
							}),
						},
					};
				}),
			},
			nodes: source.nodes.map((node) => {
				if (node.regionId !== 'd') return node;
				return { ...node, regionId: 'e' };
			}),
		};
		const document = restored(source);
		const grid = regionGrid(document);
		const cells = gridCells(document);
		const a = cells.get('a');
		reconcileSharedDocument(document, changed, 'replace cell');
		expect(regionGrid(document)).toBe(grid);
		expect(gridCells(document)).toBe(cells);
		expect(gridCells(document).get('a')).toBe(a);
		expect(gridCells(document).has('d')).toBe(false);
		expect(gridCells(document).has('e')).toBe(true);
		expect(paths(document)).toEqual([]);
		document.destroy();
	});

	it('keeps leaf-local lanes in the composition format', () => {
		const previous = regionLaneDocument();
		const presentation = previous.regionPresentation;
		if (presentation === undefined) throw new Error('Expected local lane presentation');
		const source: LogicDocument = {
			...previous,
			persistenceFormat: REGION_COMPOSITION_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
				regions: presentation.regions,
			},
		};
		const document = restored(previous);
		const lane = document
			.getMap<Y.Map<Y.Map<unknown>>>(YjsCollection.RegionLanes)
			.get('shared')
			?.get('sales');
		const label = lane?.get('label');
		reconcileSharedDocument(document, source, 'composition');
		expect(document.getMap(YjsCollection.Meta).get('yjsLiveDocumentFormat')).toBe(
			YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
		);
		expect(
			document.getMap<Y.Map<Y.Map<unknown>>>(YjsCollection.RegionLanes).get('shared')?.get('sales'),
		).toBe(lane);
		expect(lane?.get('label')).toBe(label);
		expect(paths(document)).toEqual([]);
		document.destroy();
	});

	it('keeps the region grid while a shared command adds an endpoint to a cell', async () => {
		const document = restored(compositionGridDocument());
		const grid = regionGrid(document);
		const session = attachLocalDocumentSession(document);
		try {
			const result = await session.dispatch([
				nodeCreation({
					id: 'a-new',
					natureId: 'task',
					markdown: 'New task',
					regionId: 'a',
				}),
			]);
			expect(result).toMatchObject({ kind: 'accepted' });
			expect(regionGrid(document)).toBe(grid);
			expect(session.read().nodes.find(({ id }) => id === 'a-new')?.regionId).toBe('a');
		} finally {
			session.destroy();
			document.destroy();
		}
	});

	it('reports malformed and orphan region grids at precise paths without exposing node text', () => {
		const cases: readonly {
			readonly name: string;
			readonly mutate: (document: Y.Doc) => void;
			readonly path: string;
		}[] = [
			{
				name: 'malformed grid map',
				mutate: (document) => document.getMap(YjsCollection.RegionGrids).set('grid', 'broken'),
				path: 'regionPresentation.regions.grid.grid',
			},
			{
				name: 'empty minima',
				mutate: (document) => regionGrid(document).set('minimumColumnWidths', []),
				path: 'regionPresentation.regions.grid.grid.minimumColumnWidths',
			},
			{
				name: 'negative minimum',
				mutate: (document) => regionGrid(document).set('minimumRowHeights', [50, -1]),
				path: 'regionPresentation.regions.grid.grid.minimumRowHeights.1',
			},
			{
				name: 'missing cell map',
				mutate: (document) => {
					regionGrid(document).delete('cells');
				},
				path: 'regionPresentation.regions.grid.grid.cells',
			},
			{
				name: 'malformed cell',
				mutate: (document) => gridCells(document).set('a', 'broken'),
				path: 'regionPresentation.regions.grid.grid.cells.a',
			},
			{
				name: 'invalid coordinate',
				mutate: (document) => gridCell(document, 'a').set('row', 1.5),
				path: 'regionPresentation.regions.grid.grid.cells.a.row',
			},
			{
				name: 'duplicate slot',
				mutate: (document) => gridCell(document, 'b').set('column', 0),
				path: 'regionPresentation.regions.grid.grid.cells.b',
			},
			{
				name: 'unknown cell',
				mutate: (document) => {
					const cells = gridCells(document);
					cells.delete('d');
					cells.set(
						'other',
						new Y.Map([
							['row', 1],
							['column', 1],
						]),
					);
				},
				path: 'regionPresentation.regions.grid.grid.cells.other.regionId',
			},
			{
				name: 'existing non-child cell',
				mutate: (document) => {
					const cells = gridCells(document);
					cells.delete('d');
					cells.set(
						'grid',
						new Y.Map([
							['row', 1],
							['column', 1],
						]),
					);
				},
				path: 'regionPresentation.regions.grid.grid.cells.grid.regionId',
			},
			{
				name: 'orphan grid',
				mutate: (document) => document.getMap(YjsCollection.RegionGrids).set('orphan', new Y.Map()),
				path: 'regionPresentation.regions.orphan.grid',
			},
			{
				name: 'root grid fields',
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('gridMinimumColumnWidths', [1, 1]),
				path: 'regionPresentation.grid',
			},
			{
				name: 'wrong composition schema',
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('regionPresentationSchema', 3),
				path: 'regionPresentation.schemaVersion',
			},
			{
				name: 'non numeric schema',
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('regionPresentationSchema', 'grid'),
				path: 'regionPresentation.schemaVersion',
			},
		];
		for (const testCase of cases) {
			const document = restored(compositionGridDocument());
			testCase.mutate(document);
			expect(paths(document), testCase.name).toContain(testCase.path);
			expect(JSON.stringify(diagnostics(document)), testCase.name).not.toContain(
				'PRIVATE_MARKDOWN_SENTINEL',
			);
			document.destroy();
		}
	});

	it('rejects region grids in live format 7', () => {
		const document = restored(previousRegionDocument(compositionGridDocument()));
		document.getMap(YjsCollection.RegionGrids).set('grid', new Y.Map());
		expect(paths(document)).toContain('regionPresentation.regions.grid.grid');
		document.destroy();
	});
});
