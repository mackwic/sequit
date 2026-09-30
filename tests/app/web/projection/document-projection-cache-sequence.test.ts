import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentProjection } from '../../../../src/app/web/projection/document-projection';
import * as layout from '../../../../src/app/web/projection/layout-graph';
import * as graph from '../../../../src/lib/core/graph/create-graph';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

afterEach(() => vi.restoreAllMocks());

describe('projection cache over a realistic edit sequence', () => {
	it('reuses geometry for style and collection order, and invalidates changed metrics and relations', async () => {
		const prepare = vi.spyOn(graph, 'createGraph');
		const calculate = vi.spyOn(layout, 'layoutGraphForProjection');
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'cache-sequence');
		const projection = new DocumentProjection(source);
		const measured = layoutMeasurementsForCanvas(projection.measurementModel);
		const original = await projection.createCanvasModel(measured);
		expect([prepare.mock.calls.length, calculate.mock.calls.length]).toEqual([1, 1]);

		const styled = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id === 'A') return { ...node, color: '#abcdef' };
				return node;
			}),
		};
		expect(projection.update(styled)).toBe(true);
		const recolored = await projection.createCanvasModel(measured);
		expect(recolored.relations).toBe(original.relations);
		expect([prepare.mock.calls.length, calculate.mock.calls.length]).toEqual([1, 1]);

		const rewritten = {
			...styled,
			nodes: styled.nodes.map((node) => {
				if (node.id === 'A') return { ...node, markdown: 'Alpha with an expanded description' };
				return node;
			}),
		};
		expect(projection.update(rewritten)).toBe(true);
		const resized = { ...measured, nodes: new Map(measured.nodes) };
		resized.nodes.set('A', { width: 360, height: 160 });
		const expanded = await projection.createCanvasModel(resized);
		expect(expanded.nodes.find(({ id }) => id === 'A')?.bounds.width).toBeGreaterThanOrEqual(360);
		expect([prepare.mock.calls.length, calculate.mock.calls.length]).toEqual([1, 2]);

		const unlinked = { ...rewritten, relations: [] };
		expect(projection.update(unlinked)).toBe(true);
		const disconnected = await projection.createCanvasModel(resized);
		expect(disconnected.relations).toEqual([]);
		expect([prepare.mock.calls.length, calculate.mock.calls.length]).toEqual([2, 3]);

		const permuted = { ...unlinked, nodes: [...unlinked.nodes].reverse() };
		expect(projection.update(permuted)).toBe(true);
		const reordered = await projection.createCanvasModel(resized);
		expect(reordered.nodes.map(({ id }) => id)).toEqual(['B', 'A']);
		expect([prepare.mock.calls.length, calculate.mock.calls.length]).toEqual([2, 3]);

		const sameSizesInDomOrder = { ...resized, nodes: new Map([...resized.nodes].reverse()) };
		const reusedAfterMeasurementPermutation =
			await projection.createCanvasModel(sameSizesInDomOrder);
		expect(reusedAfterMeasurementPermutation).toEqual(reordered);
		expect([prepare.mock.calls.length, calculate.mock.calls.length]).toEqual([2, 3]);
		const cold = new DocumentProjection(permuted);
		expect(reusedAfterMeasurementPermutation).toEqual(
			await cold.createCanvasModel(sameSizesInDomOrder),
		);
	});
});
