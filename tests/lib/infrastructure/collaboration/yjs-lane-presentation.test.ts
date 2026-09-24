import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { reconcileSharedDocument } from '../../../../src/lib/infrastructure/collaboration/reconcile-shared-document';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
	importLogicDocument,
	readLogicDocument,
	YJS_LANE_DOCUMENT_FORMAT,
	YJS_LIVE_DOCUMENT_FORMAT,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { SharedCommandKind } from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../support/builders/logic-document';

function imported(explicit: boolean): Y.Doc {
	const document = new Y.Doc();
	if (explicit) importLogicDocument(document, explicitLaneLogicDocument());
	else importLogicDocument(document, validLogicDocument());
	return document;
}

function diagnostics(document: Y.Doc): string[] {
	const result = readLogicDocument(document);
	if (result.ok) return [];
	return result.diagnostics.map(({ path }) => path.join('.'));
}

describe('Yjs lane presentation versions', () => {
	it('retains legacy live format 3 and reads it after binary restoration', () => {
		const original = imported(false);
		const replica = new Y.Doc();
		Y.applyUpdate(replica, Y.encodeStateAsUpdate(original));
		expect(replica.getMap(YjsCollection.Meta).get('yjsLiveDocumentFormat')).toBe(
			YJS_LIVE_DOCUMENT_FORMAT,
		);
		expect(replica.getMap(YjsCollection.Lanes).size).toBe(0);
		expect(readLogicDocument(replica)).toMatchObject({
			ok: true,
			value: { persistenceFormat: 2 },
		});
		original.destroy();
		replica.destroy();
	});

	it('round trips explicit format 3 through live format 4 and binary restoration', () => {
		const original = imported(true);
		const replica = new Y.Doc();
		Y.applyUpdate(replica, Y.encodeStateAsUpdate(original));
		expect(replica.getMap(YjsCollection.Meta).get('yjsLiveDocumentFormat')).toBe(
			YJS_LANE_DOCUMENT_FORMAT,
		);
		expect(readLogicDocument(replica)).toMatchObject({
			ok: true,
			value: {
				persistenceFormat: 3,
				presentation: { policy: 'layered', lanes: [{ id: 'left' }, { id: 'right' }] },
			},
		});
		original.destroy();
		replica.destroy();
	});

	it('rejects invalid and hidden legacy assignments', () => {
		const explicit = imported(true);
		expect(diagnostics(explicit)).toEqual([]);
		explicit.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('target')?.set('laneId', 'missing');
		expect(diagnostics(explicit)).toContain('nodes.target.lane');
		explicit.destroy();

		const legacy = imported(false);
		legacy.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('target')?.set('laneId', 'left');
		expect(diagnostics(legacy)).toContain('nodes.target.lane');
		legacy.destroy();
	});

	it('rejects mismatched live and document versions plus future presentation schema', () => {
		const document = imported(true);
		const meta = document.getMap(YjsCollection.Meta);
		meta.set('yjsLiveDocumentFormat', YJS_LIVE_DOCUMENT_FORMAT);
		expect(diagnostics(document)).toContain('persistenceFormat');
		meta.set('yjsLiveDocumentFormat', YJS_LANE_DOCUMENT_FORMAT);
		meta.set('layoutPresentationSchema', 2);
		expect(diagnostics(document)).toContain('presentation.schemaVersion');
		document.destroy();
	});

	it('diagnoses malformed live lane metadata and incomplete lane entities', () => {
		const cases: readonly {
			name: string;
			change: (document: Y.Doc) => void;
			path: string;
		}[] = [
			{
				name: 'unsupported policy',
				change: (document) => {
					document.getMap(YjsCollection.Meta).set('rootLayoutPolicy', 'force');
				},
				path: 'presentation.policy',
			},
			{
				name: 'missing orientation',
				change: (document) => {
					document.getMap(YjsCollection.Meta).delete('laneOrientation');
				},
				path: 'presentation.laneOrientation',
			},
			{
				name: 'unsupported orientation',
				change: (document) => {
					document.getMap(YjsCollection.Meta).set('laneOrientation', 'diagonal');
				},
				path: 'presentation.laneOrientation',
			},
			{
				name: 'unsupported growth',
				change: (document) => {
					document.getMap(YjsCollection.Meta).set('laneGrowth', 'fixed');
				},
				path: 'presentation.growth',
			},
			{
				name: 'missing lane label',
				change: (document) => {
					document.getMap<Y.Map<unknown>>(YjsCollection.Lanes).get('left')?.delete('label');
				},
				path: 'presentation.lanes.left.label',
			},
			{
				name: 'malformed lane entity',
				change: (document) => {
					document.getMap(YjsCollection.Lanes).set('left', 'not a lane');
				},
				path: 'presentation.lanes.left',
			},
		];
		for (const testCase of cases) {
			const document = imported(true);
			testCase.change(document);
			expect(diagnostics(document), testCase.name).toContain(testCase.path);
			document.destroy();
		}
	});

	it('upgrades a legacy shared document and preserves ownership during grouping', () => {
		const document = imported(false);
		reconcileSharedDocument(document, explicitLaneLogicDocument(), 'upgrade');
		expect(diagnostics(document)).toEqual([]);
		expect(document.getMap(YjsCollection.Meta).get('yjsLiveDocumentFormat')).toBe(
			YJS_LANE_DOCUMENT_FORMAT,
		);
		executeSharedCommands(document, [
			{
				op: SharedCommandKind.Group,
				id: 'lane-group',
				label: 'Lane group',
				members: ['target', 'endpoint-group'],
			},
		]);
		const result = readLogicDocument(document);
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error('Expected grouped lanes to be valid');
		expect(result.value.groups.find(({ id }) => id === 'lane-group')).toMatchObject({
			laneId: 'left',
		});
		expect(result.value.nodes.find(({ id }) => id === 'target')).toMatchObject({
			groupId: 'lane-group',
		});
		expect(result.value.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('laneId');
		document.destroy();
	});

	it('rejects grouping top-level owners from different lanes', () => {
		const document = imported(true);
		expect(() =>
			executeSharedCommands(document, [
				{
					op: SharedCommandKind.Group,
					id: 'cross-lane',
					label: 'Cross lane',
					members: ['target', 'isolated'],
				},
			]),
		).toThrow('même voie');
		document.destroy();
	});
});
