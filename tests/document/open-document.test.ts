import { describe, expect, it, vi } from 'vitest';

import { openDocument, type OpenedDocument } from '../../src/lib/document/open-document';
import { layoutMeasurementsForCanvas } from '../builders/layout-measurements';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

function readProjection(opened: OpenedDocument) {
	const result = opened.read();
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected the current document to project');
	return result.value;
}

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

		expect(openDocument(source)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'unknown-endpoint',
					message: 'Unknown relation source: missing-endpoint',
					path: ['relations', 'word-alcoa-question-to-traceable-edits', 'from'],
				},
			],
		});
	});

	it('uses the same immutable measurement projection across repeated layouts', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const projection = readProjection(result.value);
		const measurementModel = projection.measurementModel;
		const measurements = layoutMeasurementsForCanvas(measurementModel);

		const first = await projection.createCanvasModel(measurements);
		const second = await projection.createCanvasModel(measurements);

		expect(readProjection(result.value)).toBe(projection);
		expect(second).toEqual(first);
		expect(first.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'ALCOA+: All edits needs to be tracable\n',
		);
		result.value.close();
	});

	it('reprojects the current Yjs document after a business operation', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const listener = vi.fn();
		const unsubscribe = result.value.subscribe(listener);

		expect(
			result.value.replaceNodeMarkdown('traceable-edits', 'Updated through the session\n'),
		).toBe(true);

		const projection = readProjection(result.value);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(
			projection.measurementModel.nodes.find(({ id }) => id === 'traceable-edits')?.markdown,
		).toBe('Updated through the session\n');
		const canvas = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		expect(canvas.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'Updated through the session\n',
		);

		unsubscribe();
		result.value.close();
	});

	it('rejects layout from the returned application port when measurements are incomplete', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		const projection = readProjection(result.value);
		const complete = layoutMeasurementsForCanvas(projection.measurementModel);
		const incomplete = { ...complete, nodes: new Map(complete.nodes) };
		incomplete.nodes.delete('traceable-edits');

		await expect(projection.createCanvasModel(incomplete)).rejects.toThrow(
			'Missing node measurement: traceable-edits',
		);
		result.value.close();
	});

	it('makes subscriptions and mutations inert after close', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');
		result.value.close();

		const listener = vi.fn();
		const unsubscribe = result.value.subscribe(listener);
		unsubscribe();

		expect(result.value.replaceNodeMarkdown('traceable-edits', 'Ignored\n')).toBe(false);
		expect(listener).not.toHaveBeenCalled();
		result.value.close();
	});

	it('refreshes the projection and renders added independent peers in operation order', async () => {
		const result = openDocument(await aiDocumentaryEffortScenario());
		if (!result.ok) throw new Error('Expected the reference document to open');

		result.value.addNode({
			id: 'zz-added-first',
			natureId: 'goal',
			markdown: 'Added first',
		});
		result.value.addNode({
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
});
