import { describe, expect, it } from 'vitest';

import { createCanvasMeasurementModel, createCanvasModel } from '../../src/lib/canvas/canvas-model';
import type { LayoutResult } from '../../src/lib/layout/layout-graph';
import { validLogicDocument } from '../builders/logic-document';

function completeLayout(): LayoutResult {
	const document = validLogicDocument();
	const endpointIds = [
		...document.nodes.map(({ id }) => id),
		...document.groups.map(({ id }) => id),
		...document.junctions.map(({ id }) => id),
	];
	return {
		width: 800,
		height: 600,
		elements: endpointIds.map((id, index) => {
			let kind: 'node' | 'junction' | 'group' = 'group';
			if (document.nodes.some((node) => node.id === id)) kind = 'node';
			else if (document.junctions.some((junction) => junction.id === id)) kind = 'junction';
			return {
				id,
				kind,
				bounds: { x: index * 20, y: index * 10, width: 100, height: 50 },
			};
		}),
		relations: document.relations.map(({ id, from, to }) => ({
			id,
			from,
			to,
			points: [
				{ x: 0, y: 50 },
				{ x: 0, y: 0 },
			],
		})),
	};
}

describe('CanvasModel projection', () => {
	it('resolves presentation natures while preserving exact Markdown', () => {
		const model = createCanvasMeasurementModel(validLogicDocument());

		expect(model.nodes).toContainEqual({
			id: 'source-a',
			nature: { id: 'goal', label: 'Goal', color: '#00aa44' },
			markdown: 'Source A\n',
		});
		expect(model.groups).toHaveLength(3);
		expect(model.junctions).toEqual([{ id: 'choice', operator: 'xor' }]);
	});

	it('combines one measurement projection with layout geometry without changing content', () => {
		const measurement = createCanvasMeasurementModel(validLogicDocument());
		const canvas = createCanvasModel(measurement, completeLayout());

		expect(canvas).toMatchObject({ width: 800, height: 600 });
		expect(canvas.nodes).toHaveLength(4);
		expect(canvas.groups).toHaveLength(3);
		expect(canvas.junctions).toHaveLength(1);
		expect(canvas.relations).toHaveLength(4);
		expect(canvas.nodes.find(({ id }) => id === 'source-a')).toMatchObject({
			markdown: 'Source A\n',
			bounds: { x: 0, y: 0, width: 100, height: 50 },
		});
	});

	it('fails at the projection boundary when any semantic endpoint lacks bounds', () => {
		const measurement = createCanvasMeasurementModel(validLogicDocument());
		const layout = completeLayout();
		const incomplete = {
			...layout,
			elements: layout.elements.filter(({ id }) => id !== 'source-a'),
		};

		expect(() => createCanvasModel(measurement, incomplete)).toThrow(
			'Missing layout bounds: source-a',
		);
	});
});
