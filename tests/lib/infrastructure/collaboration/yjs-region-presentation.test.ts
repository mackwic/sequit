import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	LayoutPolicy,
	type LogicDocument,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { reconcileSharedDocument } from '../../../../src/lib/infrastructure/collaboration/reconcile-shared-document';
import { CommandRefusalCode } from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
	readSourceDocumentState,
	SourceDocumentStateKind,
} from '../../../../src/lib/infrastructure/collaboration/source-document-state';
import {
	importLogicDocument,
	readLogicDocument,
	YJS_REGION_DOCUMENT_FORMAT,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { SharedCommandKind } from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../support/builders/logic-document';

function regionDocument(): LogicDocument {
	const document = validLogicDocument();
	return {
		...document,
		persistenceFormat: REGION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_PRESENTATION_SCHEMA,
			regions: [
				{ id: 'outer', layoutOrder: orderKey('a0'), policy: LayoutPolicy.Layered },
				{
					id: 'inner',
					parentId: 'outer',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		groups: document.groups.map((group) => {
			if (group.id === 'container') return { ...group, regionId: 'inner' };
			return group;
		}),
		nodes: document.nodes.map((node) => {
			if (node.id === 'target') return { ...node, regionId: 'outer' };
			return node;
		}),
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

function paths(document: Y.Doc): readonly string[] {
	const result = readLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

describe('Yjs region presentation', () => {
	it('round trips format 4 through live format 5 and binary restoration', () => {
		const document = restored(regionDocument());
		expect(document.getMap(YjsCollection.Meta).get('yjsLiveDocumentFormat')).toBe(
			YJS_REGION_DOCUMENT_FORMAT,
		);
		expect(document.getMap(YjsCollection.Regions).size).toBe(2);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: REGION_PERSISTENCE_FORMAT,
				regionPresentation: { regions: [{ id: 'inner', parentId: 'outer' }, { id: 'outer' }] },
			},
		});
		if (!result.ok) throw new Error('Expected region source to round trip');
		expect(result.value.groups.find(({ id }) => id === 'container')).toMatchObject({
			regionId: 'inner',
		});
		document.destroy();
	});

	it('supports an empty region tree and updates an existing document in place', () => {
		const document = restored(validLogicDocument());
		const meta = document.getMap(YjsCollection.Meta);
		const title = meta.get('title');
		const source = regionDocument();
		const empty: LogicDocument = {
			...source,
			regionPresentation: { schemaVersion: REGION_PRESENTATION_SCHEMA, regions: [] },
			groups: source.groups.map((group) => {
				const result = { ...group };
				delete result.regionId;
				return result;
			}),
			nodes: source.nodes.map((node) => {
				const result = { ...node };
				delete result.regionId;
				return result;
			}),
		};
		reconcileSharedDocument(document, empty, 'upgrade');
		expect(meta.get('title')).toBe(title);
		expect(paths(document)).toEqual([]);
		expect(document.getMap(YjsCollection.Regions).size).toBe(0);
		document.destroy();
	});

	it('keeps lane and region metadata independently in live format 5', () => {
		const lanes = explicitLaneLogicDocument();
		const regions = regionDocument();
		if (regions.regionPresentation === undefined) throw new Error('Expected region presentation');
		const combined: LogicDocument = {
			...lanes,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: regions.regionPresentation,
		};
		const document = restored(combined);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: REGION_PERSISTENCE_FORMAT,
				presentation: { lanes: [{ id: 'left' }, { id: 'right' }] },
				regionPresentation: { regions: [{ id: 'inner' }, { id: 'outer' }] },
			},
		});
		document.destroy();
	});

	it('diagnoses wrong parent, cycle, assignment, schema and inherited assignment', () => {
		const cases: readonly { change: (document: Y.Doc) => void; path: string }[] = [
			{
				change: (document) => {
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Regions)
						.get('inner')
						?.set('parentId', 'missing');
				},
				path: 'regionPresentation.regions.inner.parentId',
			},
			{
				change: (document) => {
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Regions)
						.get('outer')
						?.set('parentId', 'inner');
				},
				path: 'regionPresentation.regions.outer.parentId',
			},
			{
				change: (document) => {
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
						.get('target')
						?.set('regionId', 'missing');
				},
				path: 'nodes.target.regionId',
			},
			{
				change: (document) => {
					document.getMap(YjsCollection.Meta).set('regionPresentationSchema', 2);
				},
				path: 'regionPresentation.schemaVersion',
			},
			{
				change: (document) => {
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Regions)
						.get('inner')
						?.set('policy', 'force');
				},
				path: 'regionPresentation.regions.inner.policy',
			},
			{
				change: (document) => {
					document.getMap<Y.Map<unknown>>(YjsCollection.Regions).get('inner')?.delete('policy');
				},
				path: 'regionPresentation.regions.inner.policy',
			},
			{
				change: (document) => {
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Regions)
						.get('inner')
						?.set('layoutOrder', 'bad!');
				},
				path: 'regionPresentation.regions.inner.layoutOrder',
			},
			{
				change: (document) => {
					document
						.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
						.get('source-a')
						?.set('regionId', 'outer');
				},
				path: 'nodes.source-a.regionId',
			},
		];
		for (const testCase of cases) {
			const document = restored(regionDocument());
			testCase.change(document);
			expect(paths(document)).toContain(testCase.path);
			document.destroy();
		}
	});

	it('rejects hidden region state in old live formats', () => {
		const document = restored(validLogicDocument());
		document.getMap(YjsCollection.Meta).set('regionPresentationSchema', REGION_PRESENTATION_SCHEMA);
		expect(paths(document)).toContain('regionPresentation');
		document.destroy();
	});

	it('keeps only sorted physical region identifiers in an invalid source snapshot', () => {
		const document = restored(regionDocument());
		document.getMap<Y.Map<unknown>>(YjsCollection.Regions).get('inner')?.set('parentId', 'missing');
		const source = readSourceDocumentState(document, 7);
		expect(source.kind).toBe(SourceDocumentStateKind.Invalid);
		if (source.kind !== SourceDocumentStateKind.Invalid) throw new Error('Expected invalid source');
		expect(source.snapshot.regionIds).toEqual(['inner', 'outer']);
		expect(source.snapshot.nodeIds).toContain('target');
		document.destroy();
	});

	it('groups siblings within one region and rejects a group across regions', () => {
		const source = regionDocument();
		const sameRegion: LogicDocument = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id === 'isolated') return { ...node, regionId: 'outer' };
				return node;
			}),
		};
		const document = restored(sameRegion);
		executeSharedCommands(document, [
			{
				op: SharedCommandKind.Group,
				id: 'region-group',
				label: 'Region group',
				members: ['target', 'isolated'],
			},
		]);
		const grouped = readLogicDocument(document);
		expect(grouped).toMatchObject({ ok: true });
		if (!grouped.ok) throw new Error('Expected a valid group');
		expect(grouped.value.groups.find(({ id }) => id === 'region-group')).toMatchObject({
			regionId: 'outer',
		});
		expect(grouped.value.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('regionId');
		document.destroy();

		const crossing = restored(source);
		expect(() =>
			executeSharedCommands(crossing, [
				{
					op: SharedCommandKind.Group,
					id: 'cross-region',
					label: 'Cross region',
					members: ['target', 'isolated'],
				},
			]),
		).toThrow(
			expect.objectContaining({
				reason: { code: CommandRefusalCode.ElementsDifferentRegion },
			}),
		);
		crossing.destroy();
	});
});
