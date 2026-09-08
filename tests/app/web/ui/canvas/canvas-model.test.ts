import { describe, expect, it } from 'vitest';

import type { LayoutResult } from '../../../../../src/app/web/projection/layout-graph';
import {
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../../../../../src/app/web/ui/canvas/canvas-model';
import { EndpointKind } from '../../../../../src/lib/core/document/logic-document';
import { validLogicDocument } from '../../../../support/builders/logic-document';

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
			let kind: EndpointKind = EndpointKind.Group;
			if (document.nodes.some((node) => node.id === id)) kind = EndpointKind.Node;
			else if (document.junctions.some((junction) => junction.id === id))
				kind = EndpointKind.Junction;
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

	it('rejects a node whose nature is absent from the measurement projection', () => {
		const document = validLogicDocument();
		const invalid = {
			...document,
			nodes: document.nodes.map((node) =>
				node.id === 'source-a' ? { ...node, natureId: 'missing-nature' } : node,
			),
		};

		expect(() => createCanvasMeasurementModel(invalid)).toThrow('Missing nature: missing-nature');
	});

	it('combines one measurement projection with layout geometry without changing content', () => {
		const measurement = createCanvasMeasurementModel(validLogicDocument());
		const layout = completeLayout();
		const canvas = createCanvasModel(measurement, layout);

		expect(canvas).toMatchObject({ width: 800, height: 600 });
		expect(canvas.nodes).toHaveLength(4);
		expect(canvas.groups).toHaveLength(3);
		expect(canvas.junctions).toHaveLength(1);
		expect(canvas.relations).toHaveLength(4);
		expect(canvas.nodes.find(({ id }) => id === 'source-a')).toMatchObject({
			markdown: 'Source A\n',
			bounds: { x: 0, y: 0, width: 100, height: 50 },
		});
		expect(canvas.nodes[0]?.bounds).toBe(layout.elements[0]?.bounds);
		expect(canvas.relations[0]?.points).toBe(layout.relations[0]?.points);
	});

	it('projects readonly navigation metadata from semantic order and accepted ranks', () => {
		const document = validLogicDocument();
		const measurement = createCanvasMeasurementModel(document);
		const ranks = new Map(document.nodes.map(({ id }, rank) => [id, rank]));
		const canvas = createCanvasModel(measurement, completeLayout(), {
			document: {
				...document,
				groups: document.groups.map((group) =>
					group.id === 'container' ? { ...group, groupId: 'endpoint-group' } : group,
				),
			},
			ranks: { byEndpointId: ranks },
		});

		expect(canvas.nodes.find(({ id }) => id === 'source-a')?.navigation).toEqual({
			groupId: 'container',
			layoutOrder: 'a3',
			rank: 0,
		});
		expect(canvas.nodes.find(({ id }) => id === 'target')?.navigation).toEqual({
			layoutOrder: 'a5',
			rank: 2,
		});
		expect(canvas.groups.find(({ id }) => id === 'container')?.navigation).toEqual({
			groupId: 'endpoint-group',
			layoutOrder: 'a0',
		});
		expect(canvas.groups.find(({ id }) => id === 'endpoint-group')?.navigation).toEqual({
			layoutOrder: 'a1',
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
