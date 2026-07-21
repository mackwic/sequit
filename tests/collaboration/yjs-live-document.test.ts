import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
	replaceNodeMarkdown,
	YJS_LIVE_DOCUMENT_FORMAT,
} from '../../src/lib/collaboration/yjs-live-document';
import type { LogicDocument } from '../../src/lib/document/logic-document';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

async function referenceDocument(): Promise<LogicDocument> {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	return parsed.value;
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

	it('rejects an incompatible imported persistence format independently of the live version', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		ydoc.getMap('sequit.meta').set('persistenceFormat', 2);

		expect(readLogicDocument(ydoc)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'invalid-yjs-live-document',
					message: 'Unsupported imported persistenceFormat: 2',
					path: ['persistenceFormat'],
				},
			],
		});
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
});
