import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Size } from '../../src/lib/layout/layout-graph';
import { acyclicLogicDocumentArbitrary } from '../builders/logic-document-arbitrary';
import { layoutDocument } from '../harnesses/layout';

const sizeArbitrary: fc.Arbitrary<Size> = fc.record({
	width: fc.integer({ min: 1, max: 600 }),
	height: fc.integer({ min: 1, max: 300 }),
});

function sizeAt(sizes: readonly Size[], index: number): Size {
	const size = sizes[index];
	if (size === undefined) throw new Error(`Missing generated measurement at index ${index}`);
	return size;
}

const layoutCaseArbitrary = acyclicLogicDocumentArbitrary({ minNodes: 1, maxNodes: 12 }).chain(
	(document) =>
		fc
			.array(sizeArbitrary, {
				minLength: document.nodes.length,
				maxLength: document.nodes.length,
			})
			.map((sizes) => ({
				document,
				nodeMeasurements: Object.fromEntries(
					document.nodes.map(({ id }, index) => [id, sizeAt(sizes, index)]),
				),
			})),
);

function expectFinite(value: number): void {
	expect(Number.isFinite(value)).toBe(true);
}

describe('generated layouts', () => {
	it('produces only finite coordinates and dimensions for every generated DAG', async () => {
		await fc.assert(
			fc.asyncProperty(layoutCaseArbitrary, async ({ document, nodeMeasurements }) => {
				const { layout } = await layoutDocument(document, { nodes: nodeMeasurements });
				expectFinite(layout.width);
				expectFinite(layout.height);
				for (const { bounds } of layout.elements) {
					expectFinite(bounds.x);
					expectFinite(bounds.y);
					expectFinite(bounds.width);
					expectFinite(bounds.height);
				}
				for (const relation of layout.relations) {
					for (const point of relation.points) {
						expectFinite(point.x);
						expectFinite(point.y);
					}
				}
			}),
			{ numRuns: 100 },
		);
	});
});
