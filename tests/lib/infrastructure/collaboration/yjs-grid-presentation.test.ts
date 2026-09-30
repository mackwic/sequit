import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { nodeCreation } from '../../../../src/app/web/document/document-commands';
import { attachLocalDocumentSession } from '../../../../src/app/web/document/local-document-session';
import {
	GRID_PERSISTENCE_FORMAT,
	GRID_REGION_PRESENTATION_SCHEMA,
	type LogicDocument,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { reconcileSharedDocument } from '../../../../src/lib/infrastructure/collaboration/reconcile-shared-document';
import {
	importLogicDocument,
	readLogicDocument,
	YJS_GRID_DOCUMENT_FORMAT,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import {
	persistedGridDocument,
	persistedNxmGridDocument,
} from '../../core/layout/grid-cell-fixture';

function restored(source: LogicDocument): Y.Doc {
	const original = new Y.Doc();
	importLogicDocument(original, source);
	const replica = new Y.Doc();
	Y.applyUpdate(replica, Y.encodeStateAsUpdate(original));
	original.destroy();
	return replica;
}

function paths(document: Y.Doc): readonly string[] {
	const result = readLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

describe('Yjs grid presentation', () => {
	it('round trips TOML format 5 through Yjs format 6 and binary restoration', () => {
		const document = restored(persistedGridDocument());
		const meta = document.getMap(YjsCollection.Meta);
		expect(meta.get('yjsLiveDocumentFormat')).toBe(YJS_GRID_DOCUMENT_FORMAT);
		expect(meta.get('persistenceFormat')).toBe(GRID_PERSISTENCE_FORMAT);
		expect(document.getMap(YjsCollection.GridCells).size).toBe(4);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: GRID_PERSISTENCE_FORMAT,
				regionPresentation: {
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
		if (!result.ok) throw new Error('Expected shared grid document to round trip');
		expect(result.value.nodes.find(({ id }) => id === 'a-top')).toMatchObject({ regionId: 'a' });
		document.destroy();
	});

	it('keeps existing Y.Text identity through upgrade and clears grid fields on downgrade', () => {
		const grid = persistedGridDocument();
		const legacy: LogicDocument = {
			...grid,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_PRESENTATION_SCHEMA,
				regions: grid.regionPresentation?.regions ?? [],
			},
		};
		const document = restored(legacy);
		const meta = document.getMap(YjsCollection.Meta);
		const title = meta.get('title');
		reconcileSharedDocument(document, grid, 'upgrade');
		expect(meta.get('title')).toBe(title);
		expect(paths(document)).toEqual([]);
		expect(document.getMap(YjsCollection.GridCells).size).toBe(4);
		reconcileSharedDocument(document, legacy, 'downgrade');
		expect(paths(document)).toEqual([]);
		expect(document.getMap(YjsCollection.GridCells).size).toBe(0);
		expect(meta.has('gridMinimumColumnWidths')).toBe(false);
		expect(meta.has('gridMinimumRowHeights')).toBe(false);
		document.destroy();
	});

	it('reports a coordinate or minimum error at the grid path without exposing node text', () => {
		const document = restored(persistedGridDocument());
		const cell = document.getMap<Y.Map<unknown>>(YjsCollection.GridCells).get('b');
		if (cell === undefined) throw new Error('Expected cell b');
		cell.set('column', 1.5);
		expect(paths(document)).toContain('regionPresentation.grid.cells.b.column');
		cell.set('column', 1);
		document.getMap(YjsCollection.Meta).set('gridMinimumRowHeights', [50, -1]);
		expect(paths(document)).toContain('regionPresentation.grid.minimumRowHeights.1');
		document.destroy();
	});

	it('rejects malformed shared grid metadata and cell coordinates after binary restoration', () => {
		const invalidChanges: readonly {
			readonly mutate: (document: Y.Doc) => void;
			readonly path: string;
		}[] = [
			{
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('gridMinimumColumnWidths', []),
				path: 'regionPresentation.grid.minimumColumnWidths',
			},
			{
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('gridMinimumColumnWidths', ['700', 100]),
				path: 'regionPresentation.grid.minimumColumnWidths.0',
			},
			{
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('gridMinimumColumnWidths', [700, -1]),
				path: 'regionPresentation.grid.minimumColumnWidths.1',
			},
			{
				mutate: (document) =>
					document.getMap(YjsCollection.Meta).set('regionPresentationSchema', 1),
				path: 'regionPresentation.schemaVersion',
			},
			{
				mutate: (document) => {
					const cell = document.getMap<Y.Map<unknown>>(YjsCollection.GridCells).get('a');
					if (cell === undefined) throw new Error('Expected cell a');
					cell.set('row', -1);
				},
				path: 'regionPresentation.grid.cells.a.row',
			},
			{
				mutate: (document) => {
					const cell = document.getMap<Y.Map<unknown>>(YjsCollection.GridCells).get('b');
					if (cell === undefined) throw new Error('Expected cell b');
					cell.set('column', '0');
				},
				path: 'regionPresentation.grid.cells.b.column',
			},
		];
		for (const { mutate, path } of invalidChanges) {
			const document = restored(persistedGridDocument());
			mutate(document);
			expect(paths(document), path).toContain(path);
			document.destroy();
		}
	});

	it('rejects orphaned grid metadata under the earlier region format', () => {
		const source = persistedGridDocument();
		const legacy: LogicDocument = {
			...source,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_PRESENTATION_SCHEMA,
				regions: source.regionPresentation?.regions ?? [],
			},
		};
		const document = restored(legacy);
		document.getMap(YjsCollection.Meta).set('gridMinimumColumnWidths', [700, 100]);
		expect(paths(document)).toContain('regionPresentation.grid');
		document.destroy();
	});

	it('preserves cell ownership when a shared command adds a node to a cell', async () => {
		const document = restored(persistedGridDocument());
		const session = attachLocalDocumentSession(document);
		try {
			const result = await session.dispatch([
				nodeCreation({
					id: 'a-new',
					natureId: 'task',
					markdown: 'A new task',
					regionId: 'a',
				}),
			]);
			expect(result).toMatchObject({ kind: 'accepted' });
			const read = session.read();
			expect(read.nodes.find(({ id }) => id === 'a-new')?.regionId).toBe('a');
		} finally {
			session.destroy();
			document.destroy();
		}
	});

	it('round trips the three by two grid with six cells through Yjs', () => {
		const document = restored(persistedNxmGridDocument());
		expect(document.getMap(YjsCollection.GridCells).size).toBe(6);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({
			ok: true,
			value: {
				regionPresentation: {
					grid: {
						minimumColumnWidths: [180, 120, 140],
						minimumRowHeights: [70, 90],
					},
				},
			},
		});
		if (!result.ok) throw new Error('Expected the shared three by two grid to round trip');
		expect(
			result.value.regionPresentation?.grid?.cells.map(
				({ regionId, row, column }) => `${regionId}:${row}:${column}`,
			),
		).toEqual(['a:0:0', 'b:0:1', 'c:0:2', 'd:1:0', 'e:1:1', 'f:1:2']);
		document.destroy();
	});

	it('reads a historical grid schema and materializes the current one', () => {
		const document = restored(persistedGridDocument());
		document.getMap(YjsCollection.Meta).set('regionPresentationSchema', 2);
		expect(paths(document)).toEqual([]);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({
			ok: true,
			value: { regionPresentation: { schemaVersion: GRID_REGION_PRESENTATION_SCHEMA } },
		});
		document.destroy();
	});
});
