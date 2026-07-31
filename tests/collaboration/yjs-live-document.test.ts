import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	addNodeToLiveDocument,
	importLogicDocument,
	readLogicDocument,
	replaceNodeMarkdown,
	YJS_LIVE_DOCUMENT_FORMAT,
} from '../../src/lib/collaboration/yjs-live-document';
import { JunctionOperator, type LogicDocument } from '../../src/lib/document/logic-document';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { validLogicDocument } from '../builders/logic-document';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

async function referenceDocument(): Promise<LogicDocument> {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	return parsed.value;
}

async function importedReferenceDocument(): Promise<Y.Doc> {
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, await referenceDocument());
	return ydoc;
}

function readDocument(ydoc: Y.Doc): LogicDocument {
	const result = readLogicDocument(ydoc);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected a readable Yjs document');
	return result.value;
}
function readFailure(ydoc: Y.Doc) {
	const result = readLogicDocument(ydoc);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('Expected an invalid Yjs document');
	return result.diagnostics;
}

describe('yjsLiveDocumentFormat', () => {
	it('imports and reads the complete document without semantic loss', async () => {
		const expected = await referenceDocument();
		const ydoc = new Y.Doc();

		importLogicDocument(ydoc, expected);

		expect(ydoc.getMap('sequit.meta').get('yjsLiveDocumentFormat')).toBe(YJS_LIVE_DOCUMENT_FORMAT);
		expect(readDocument(ydoc)).toEqual(expected);
	});

	it('round trips explicit endpoint order through Y.Array snapshots', async () => {
		const expected = {
			...(await referenceDocument()),
			endpointOrder: ['training-roi', 'onlyoffice'],
		};
		const source = new Y.Doc();
		importLogicDocument(source, expected);
		expect(source.getMap('sequit.meta').get('endpointOrder')).toBeInstanceOf(Y.Array);

		const snapshot = new Y.Doc();
		Y.applyUpdate(snapshot, Y.encodeStateAsUpdate(source));
		expect(readDocument(snapshot)).toEqual(expected);
	});

	it('preserves absent endpoint order through import and snapshots', async () => {
		const expected = await referenceDocument();
		const source = new Y.Doc();
		importLogicDocument(source, expected);
		expect(source.getMap('sequit.meta').has('endpointOrder')).toBe(false);

		const snapshot = new Y.Doc();
		Y.applyUpdate(snapshot, Y.encodeStateAsUpdate(source));
		expect(readDocument(snapshot)).not.toHaveProperty('endpointOrder');
	});

	it('stores and preserves each exact Markdown value in Y.Text', async () => {
		const expected = await referenceDocument();
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, expected);

		const node = ydoc.getMap<Y.Map<unknown>>('sequit.nodes').get('traceable-edits');
		const markdown = node?.get('markdown');

		expect(markdown).toBeInstanceOf(Y.Text);
		expect(markdown?.toString()).toBe('ALCOA+: All edits needs to be tracable\n');
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'ALCOA+: All edits needs to be tracable\n',
		);
	});

	it('rejects an unknown live document version independently', () => {
		const ydoc = new Y.Doc();
		ydoc.getMap('sequit.meta').set('yjsLiveDocumentFormat', 3);

		expect(readLogicDocument(ydoc)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'unsupported-yjs-live-document-format',
					message: 'Unsupported yjsLiveDocumentFormat: 3',
					path: ['yjsLiveDocumentFormat'],
				},
			],
		});
	});

	it('does not couple the live schema to the source persistence format', async () => {
		const expected = await referenceDocument();
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, expected);
		const meta = ydoc.getMap('sequit.meta');

		expect(meta.has('persistenceFormat')).toBe(false);
		meta.set('persistenceFormat', 999);
		expect(readDocument(ydoc)).toEqual(expected);
	});
	it('rejects incompatible layout preferences stored in shared metadata', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		ydoc.getMap('sequit.meta').set('layoutBias', 'right');

		expect(readFailure(ydoc)).toContainEqual({
			code: 'invalid-yjs-live-document',
			message: 'Layout bias right is incompatible with direction bottom-to-top',
			path: ['layout', 'bias'],
		});
	});

	it('rejects malformed shared entity and Markdown structures at their logical paths', async () => {
		const malformedEntity = new Y.Doc();
		importLogicDocument(malformedEntity, await referenceDocument());
		malformedEntity.getMap<unknown>('sequit.nodes').set('broken-node', 'not-a-map');

		expect(readFailure(malformedEntity)).toContainEqual(
			expect.objectContaining({
				code: 'invalid-yjs-live-document',
				path: ['nodes', 'broken-node'],
			}),
		);

		const malformedMarkdown = new Y.Doc();
		importLogicDocument(malformedMarkdown, await referenceDocument());
		malformedMarkdown
			.getMap<Y.Map<unknown>>('sequit.nodes')
			.get('traceable-edits')
			?.set('markdown', 'not-a-y-text');

		expect(readFailure(malformedMarkdown)).toContainEqual(
			expect.objectContaining({
				code: 'invalid-yjs-live-document',
				path: ['nodes', 'traceable-edits', 'markdown'],
			}),
		);
	});

	it('revalidates domain references after reading shared state', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		ydoc
			.getMap<Y.Map<unknown>>('sequit.nodes')
			.get('traceable-edits')
			?.set('natureId', 'missing-nature');

		expect(readFailure(ydoc)).toContainEqual({
			code: 'invalid-yjs-live-document',
			message: 'Unknown nature: missing-nature',
			path: ['nodes', 'traceable-edits', 'nature'],
		});
	});

	it('does not create an update when a fine-grained operation cannot find its target', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const stateBefore = Y.encodeStateVector(ydoc);

		expect(replaceNodeMarkdown(ydoc, 'missing-node', 'Ignored')).toBe(false);
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
	});

	it('adds a node and its effective endpoint order in one transaction', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const updates: unknown[] = [];
		ydoc.on('update', (_update, origin) => updates.push(origin));

		const result = addNodeToLiveDocument(ydoc, {
			id: 'zz-new-node',
			natureId: 'goal',
			markdown: 'New goal',
		});

		expect(result.ok).toBe(true);
		expect(updates).toEqual(['sequit:add-node']);
		expect(readDocument(ydoc).nodes).toContainEqual({
			id: 'zz-new-node',
			natureId: 'goal',
			markdown: 'New goal',
		});
		expect(readDocument(ydoc).endpointOrder?.at(-1)).toBe('zz-new-node');
	});

	it('rejects invalid node references without partial writes', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const before = readDocument(ydoc);
		const stateBefore = Y.encodeStateVector(ydoc);

		const result = addNodeToLiveDocument(ydoc, {
			id: 'invalid-node',
			natureId: 'missing-nature',
			groupId: 'missing-group',
			markdown: 'Invalid',
		});

		expect(result.ok).toBe(false);
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
		expect(readDocument(ydoc)).toEqual(before);
	});

	it('seeds legacy order once and preserves sequential node addition order', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());

		for (const id of ['zz-added-first', 'aa-added-second', 'mm-added-third']) {
			const result = addNodeToLiveDocument(ydoc, {
				id,
				natureId: 'goal',
				markdown: id,
			});
			expect(result.ok).toBe(true);
		}

		expect(readDocument(ydoc).endpointOrder?.slice(-3)).toEqual([
			'zz-added-first',
			'aa-added-second',
			'mm-added-third',
		]);
	});

	it('preserves endpoint order under unrelated Markdown edits', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		addNodeToLiveDocument(ydoc, {
			id: 'new-node',
			natureId: 'goal',
			markdown: 'New',
		});
		const order = readDocument(ydoc).endpointOrder;

		expect(replaceNodeMarkdown(ydoc, 'traceable-edits', 'Changed')).toBe(true);
		expect(readDocument(ydoc).endpointOrder).toEqual(order);
	});

	it('converges independent fine-grained business operations without replacing collections', async () => {
		const first = new Y.Doc();
		importLogicDocument(first, await referenceDocument());
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);
		const firstCollectionChanges: string[] = [];
		const secondCollectionChanges: string[] = [];
		first
			.getMap('sequit.nodes')
			.observe((event) => firstCollectionChanges.push(...event.keysChanged));
		second
			.getMap('sequit.nodes')
			.observe((event) => secondCollectionChanges.push(...event.keysChanged));

		expect(replaceNodeMarkdown(first, 'traceable-edits', 'First independent edit\n')).toBe(true);
		expect(replaceNodeMarkdown(second, 'training-roi', 'Second independent edit\n')).toBe(true);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		expect(readDocument(first)).toEqual(readDocument(second));
		expect(readDocument(first).nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'traceable-edits', markdown: 'First independent edit\n' }),
				expect.objectContaining({ id: 'training-roi', markdown: 'Second independent edit\n' }),
			]),
		);
		expect(firstCollectionChanges).toEqual([]);
		expect(secondCollectionChanges).toEqual([]);
	});

	it('round-trips nested groups and grouped junctions', () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			groups: base.groups.map((group) =>
				group.id === 'container' ? { ...group, groupId: 'orphan-group' } : group,
			),
			junctions: [
				...base.junctions.map((junction) => ({ ...junction, groupId: 'container' })),
				{ id: 'ungrouped-choice', operator: JunctionOperator.Xor },
			],
		};
		const ydoc = new Y.Doc();

		importLogicDocument(ydoc, document);

		const current = readDocument(ydoc);
		expect(current.groups).toContainEqual({
			id: 'container',
			label: 'Container',
			groupId: 'orphan-group',
		});
		expect(current.junctions).toContainEqual({
			id: 'choice',
			operator: JunctionOperator.Xor,
			groupId: 'container',
		});
	});

	it('collects every malformed shared scalar and entity projection', async () => {
		const ydoc = await importedReferenceDocument();
		const meta = ydoc.getMap('sequit.meta');
		meta.set('id', 42);
		meta.set('title', false);
		meta.set('layoutDirection', 'diagonal');
		meta.set('layoutBias', 'middle');

		const natures = ydoc.getMap<Y.Map<unknown>>('sequit.natures');
		const natureIds = [...natures.keys()];
		natures.get(natureIds[0] ?? '')?.set('label', 42);
		natures.get(natureIds[1] ?? '')?.set('color', false);

		const groups = ydoc.getMap<Y.Map<unknown>>('sequit.groups');
		const group = groups.get([...groups.keys()][0] ?? '');
		group?.set('label', 42);
		group?.set('groupId', false);

		const nodes = ydoc.getMap<Y.Map<unknown>>('sequit.nodes');
		const node = nodes.get([...nodes.keys()][0] ?? '');
		node?.set('natureId', 42);
		node?.set('groupId', false);

		const junctions = ydoc.getMap<Y.Map<unknown>>('sequit.junctions');
		const unsupportedJunction = new Y.Map<unknown>();
		unsupportedJunction.set('operator', 'and');
		unsupportedJunction.set('groupId', 42);
		junctions.set('unsupported', unsupportedJunction);
		junctions.set('missing-operator', new Y.Map());

		const relations = ydoc.getMap<Y.Map<unknown>>('sequit.relations');
		const invalidFrom = new Y.Map<unknown>();
		invalidFrom.set('from', 42);
		invalidFrom.set('to', 'target');
		relations.set('invalid-from', invalidFrom);
		const invalidTo = new Y.Map<unknown>();
		invalidTo.set('from', 'source');
		invalidTo.set('to', false);
		relations.set('invalid-to', invalidTo);

		const diagnostics = readFailure(ydoc);
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: ['document', 'id'] }),
				expect.objectContaining({ path: ['layout', 'direction'] }),
				expect.objectContaining({ path: ['natures', natureIds[0], 'label'] }),
				expect.objectContaining({ path: ['groups', expect.any(String), 'group'] }),
				expect.objectContaining({ path: ['nodes', expect.any(String), 'nature'] }),
				expect.objectContaining({ path: ['junctions', 'unsupported', 'operator'] }),
				expect.objectContaining({ path: ['relations', 'invalid-to', 'to'] }),
			]),
		);
	});

	it('rejects Markdown replacement when the target field is not Y.Text', async () => {
		const ydoc = await importedReferenceDocument();
		const nodes = ydoc.getMap<Y.Map<unknown>>('sequit.nodes');
		const node = nodes.get([...nodes.keys()][0] ?? '');
		node?.set('markdown', 'invalid');

		expect(replaceNodeMarkdown(ydoc, [...nodes.keys()][0] ?? '', 'Ignored')).toBe(false);
	});
});
