import { describe, expect, it } from 'vitest';

import { openDocument } from '../../src/lib/document/open-document';
import { layoutMeasurementsForCanvas } from '../builders/layout-measurements';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

function expectDocument<T>(result: { ok: boolean; value?: T }): T {
	expect(result.ok).toBe(true);
	if (!result.ok || result.value === undefined) throw new Error('Expected a valid document');
	return result.value;
}

describe('AI for documentary effort', () => {
	describe('when the persistent document is opened', () => {
		it('renders its complete dependency graph through the application use case', async () => {
			const source = await aiDocumentaryEffortScenario();

			const opened = expectDocument(openDocument(source));
			const projection = expectDocument(opened.read());
			const canvas = await projection.createCanvasModel(
				layoutMeasurementsForCanvas(projection.measurementModel),
			);

			expect(projection.measurementModel.nodes).toHaveLength(24);
			expect(canvas.nodes).toHaveLength(24);
			expect(canvas.groups).toHaveLength(2);
			expect(canvas.junctions).toEqual([
				expect.objectContaining({ id: 'word-ui-options', operator: 'xor' }),
			]);
			expect(canvas.relations).toHaveLength(20);
			expect(canvas.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
				'ALCOA+: All edits needs to be tracable\n',
			);
			expect(canvas.groups).toContainEqual(
				expect.objectContaining({ id: 'data-team', label: 'Data team' }),
			);
			expect(canvas.width).toBeGreaterThan(0);
			expect(canvas.height).toBeGreaterThan(0);
			opened.close();
		});

		it('appends isolated nodes after established comparable peers in addition order', async () => {
			const opened = expectDocument(openDocument(await aiDocumentaryEffortScenario()));
			const before = await opened.createCanvasModel(
				layoutMeasurementsForCanvas(opened.measurementModel),
			);
			const establishedPeerIds = [
				'alcoa-plus',
				'docx-word-compatible',
				'preserve-partner-content',
				'prompt-management',
			];
			const establishedX = new Map(
				before.nodes
					.filter(({ id }) => establishedPeerIds.includes(id))
					.map(({ id, bounds }) => [id, bounds.x]),
			);

			opened.addNode({
				id: 'zz-added-first',
				natureId: 'goal',
				markdown: 'Added first',
			});
			opened.addNode({
				id: 'aa-added-second',
				natureId: 'goal',
				markdown: 'Added second',
			});
			const after = await opened.createCanvasModel(
				layoutMeasurementsForCanvas(opened.measurementModel),
			);
			const first = after.nodes.find(({ id }) => id === 'zz-added-first');
			const second = after.nodes.find(({ id }) => id === 'aa-added-second');
			const establishedAfter = after.nodes.filter(({ id }) => establishedPeerIds.includes(id));

			expect(first?.bounds.x).toBeGreaterThan(
				Math.max(...establishedAfter.map(({ bounds }) => bounds.x)),
			);
			expect(first?.bounds.x).toBeLessThan(second?.bounds.x ?? 0);
			expect(first?.bounds.y).toBe(second?.bounds.y);
			expect(
				new Map(establishedAfter.map(({ id, bounds }) => [id, bounds.x])),
			).toEqual(establishedX);
		});
	});
});
