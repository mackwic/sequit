import { describe, expect, it } from 'vitest';

import type { CanvasModel } from '../../src/lib/canvas/canvas-model';
import { openDocument } from '../../src/lib/document/open-document';
import { layoutMeasurementsForCanvas } from '../builders/layout-measurements';

const documentBody = `
persistenceFormat = 1

[document]
id = "endpoint-order"
title = "Endpoint order"

[layout]
direction = "top-to-bottom"
bias = "top"

[natures.goal]
label = "Goal"
color = "#12c930"

[groups]

[nodes.z-source]
nature = "goal"
markdown = "Z source"

[nodes.a-source]
nature = "goal"
markdown = "A source"

[nodes.target]
nature = "goal"
markdown = "Target"

[junctions]

[relations.z-to-target]
from = "z-source"
to = "target"

[relations.a-to-target]
from = "a-source"
to = "target"
`;

async function render(source: string): Promise<CanvasModel> {
	const result = openDocument(source);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected the TOML document to open');
	return result.value.createCanvasModel(layoutMeasurementsForCanvas(result.value.measurementModel));
}

describe('persisted endpoint order', () => {
	it('controls rendered cross-axis order without changing dependency ranks', async () => {
		const canonicalCanvas = await render(documentBody);
		const orderedCanvas = await render(
			documentBody.replace(
				'bias = "top"',
				'bias = "top"\nendpointOrder = ["z-source", "a-source", "target"]',
			),
		);
		const canonicalBounds = new Map(canonicalCanvas.nodes.map(({ id, bounds }) => [id, bounds]));
		const orderedBounds = new Map(orderedCanvas.nodes.map(({ id, bounds }) => [id, bounds]));

		expect(orderedBounds.get('z-source')?.x).toBeLessThan(orderedBounds.get('a-source')?.x ?? 0);
		expect(orderedBounds.get('z-source')?.y).toBe(orderedBounds.get('a-source')?.y);
		expect(orderedBounds.get('target')?.y).toBeGreaterThan(
			orderedBounds.get('z-source')?.y ?? Number.POSITIVE_INFINITY,
		);
		for (const id of ['z-source', 'a-source', 'target']) {
			expect(orderedBounds.get(id)?.y).toBe(canonicalBounds.get(id)?.y);
		}
	});
});
