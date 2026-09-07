import { describe, expect, it, vi } from 'vitest';

import { createDocumentSession } from '../../src/lib/collaboration/yjs-document-session';
import type { LogicDocument } from '../../src/lib/document/logic-document';
import { openDocument } from '../../src/lib/document/open-document';
import { layoutMeasurementsForCanvas } from '../builders/layout-measurements';
import { crossingDocument } from '../fixtures';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

describe('openDocument', () => {
	it('returns normalized parser diagnostics without starting downstream projections', () => {
		const result = openDocument('persistenceFormat = [');
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected parser diagnostics');

		expect(result.diagnostics[0]).toMatchObject({
			code: 'toml-syntax',
			path: [],
		});
		expect(result.diagnostics[0]?.line).toBeTypeOf('number');
		expect(result.diagnostics[0]?.column).toBeTypeOf('number');
	});

	it('returns graph diagnostics when the persisted relation targets an unknown endpoint', async () => {
		const source = (await aiDocumentaryEffortScenario()).replace(
			'from = "word-alcoa-question"',
			'from = "missing-endpoint"',
		);
		const sessionFactory = vi.fn(createDocumentSession);

		expect(openDocument(source, sessionFactory)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'unknown-endpoint',
					message: 'Unknown relation source: missing-endpoint',
					path: ['relations', 'word-alcoa-question-to-traceable-edits', 'from'],
				},
			],
		});
		expect(sessionFactory).not.toHaveBeenCalled();
	});

	it('returns a diagnostic when session creation fails', async () => {
		const failure = new Error('Session unavailable');
		const result = openDocument(await aiDocumentaryEffortScenario(), () => {
			throw failure;
		});

		expect(result).toEqual({
			ok: false,
			diagnostics: [{ code: 'open-document-failed', message: failure.message, path: [] }],
		});
	});

	it('normalizes a non-Error session creation failure', async () => {
		expect(
			openDocument(await aiDocumentaryEffortScenario(), () => {
				throw new Error('Session unavailable');
			}),
		).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'open-document-failed', message: 'Session unavailable', path: [] }],
		});
	});

	it('destroys the session when opened-document construction fails', async () => {
		const source = await aiDocumentaryEffortScenario();
		const destroyed = vi.fn();
		const sessionFactory = vi.fn((document: LogicDocument) => {
			const session = createDocumentSession(document);
			vi.spyOn(session, 'subscribe').mockImplementation(() => {
				throw new Error('Subscription unavailable');
			});
			vi.spyOn(session, 'destroy').mockImplementation(destroyed);
			return session;
		});

		const result = openDocument(source, sessionFactory);

		expect(result).toMatchObject({ ok: false });
		expect(destroyed).toHaveBeenCalledOnce();
	});

	it('preserves result diagnostics when failed construction cleanup also fails', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario(), (document) => {
			const session = createDocumentSession(document);
			vi.spyOn(session, 'subscribe').mockImplementation(() => {
				throw new Error('Subscription unavailable');
			});
			vi.spyOn(session, 'destroy').mockImplementation(() => {
				throw new Error('Cleanup unavailable');
			});
			return session;
		});

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{ code: 'open-document-failed', message: 'Subscription unavailable', path: [] },
				{ code: 'open-document-cleanup-failed', message: 'Cleanup unavailable', path: [] },
			],
		});
	});

	it('uses the same immutable measurement projection across repeated layouts', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const measurementModel = result.value.measurementModel;
		const measurements = layoutMeasurementsForCanvas(measurementModel);

		const first = await result.value.createCanvasModel(measurements);
		const second = await result.value.createCanvasModel(measurements);

		expect(result.value.measurementModel).toBe(measurementModel);
		expect(second).toEqual(first);
		expect(first.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'ALCOA+: All edits needs to be tracable\n',
		);
	});

	it('rejects layout from the returned application port when measurements are incomplete', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const complete = layoutMeasurementsForCanvas(result.value.measurementModel);
		const incomplete = { ...complete, nodes: new Map(complete.nodes) };
		incomplete.nodes.delete('traceable-edits');

		await expect(result.value.createCanvasModel(incomplete)).rejects.toThrow(
			'Missing node measurement: traceable-edits',
		);
	});

	it('refreshes the projection and renders added independent peers in operation order', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');

		await result.value.addNode({
			id: 'zz-added-first',
			natureId: 'goal',
			markdown: 'Added first',
		});
		await result.value.addNode({
			id: 'aa-added-second',
			natureId: 'goal',
			markdown: 'Added second',
		});
		const canvas = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);
		const first = canvas.nodes.find(({ id }) => id === 'zz-added-first');
		const second = canvas.nodes.find(({ id }) => id === 'aa-added-second');

		expect(result.value.measurementModel.nodes).toHaveLength(26);
		expect(result.value.measurementModel.nodes.map(({ id }) => id)).toEqual(
			expect.arrayContaining(['zz-added-first', 'aa-added-second']),
		);
		expect(first?.bounds.y).toBe(second?.bounds.y);
		expect(first?.bounds.x).toBeLessThan(second?.bounds.x ?? 0);
	});

	it('moves only an eligible relation target to its strict-improvement rendered slot', async () => {
		const result = openDocument(crossingDocument);
		if (!result.ok) throw new Error('Expected the crossing document to open');
		const before = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);
		const successorBefore = before.nodes.find(({ id }) => id === 'successor')?.bounds;

		await result.value.addRelation({
			id: 'source-a-to-target-b',
			from: 'source-a',
			to: 'target-b',
		});
		const after = await result.value.createCanvasModel(
			layoutMeasurementsForCanvas(result.value.measurementModel),
		);
		const bounds = new Map(after.nodes.map(({ id, bounds: nodeBounds }) => [id, nodeBounds]));

		expect(bounds.get('target-b')?.x).toBeLessThan(bounds.get('target-a')?.x ?? 0);
		expect(bounds.get('target-a')?.x).toBeLessThan(bounds.get('helper')?.x ?? 0);
		expect(bounds.get('target-a')?.y).toBe(bounds.get('target-b')?.y);
		expect(bounds.get('source-a')?.x).toBeLessThan(bounds.get('source-b')?.x ?? 0);
		expect(bounds.get('source-a')?.y).toBe(bounds.get('source-b')?.y);
		expect(bounds.get('successor')).toEqual(successorBefore);
		expect(bounds.get('isolated')?.x).toBeGreaterThan(bounds.get('successor')?.x ?? 0);
	});
});
