import { describe, expect, it } from 'vitest';

import { openDocument } from '../../src/lib/document/open-document';
import { layoutMeasurementsForCanvas } from '../builders/layout-measurements';
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
});
