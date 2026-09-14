import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../../../../src/app/web/ui/canvas/canvas-model';
import {
	collapsedDocument,
	projectCollapsedDocument,
} from '../../../../src/lib/core/document/collapsed-document';
import { EndpointKind, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { layoutDocument } from '../../../support/harnesses/layout';

function groupedDocument(): LogicDocument {
	return {
		...validLogicDocument(),
		groups: [
			{ kind: EndpointKind.Group, id: 'outer', label: 'Outer', layoutOrder: orderKey('a0') },
			{
				kind: EndpointKind.Group,
				id: 'inner',
				label: 'Inner',
				groupId: 'outer',
				layoutOrder: orderKey('a1'),
			},
		],
		nodes: ['a', 'b', 'c'].map((id, index) => {
			const node = {
				kind: EndpointKind.Node as const,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: orderKey(`a${index + 2}`),
			};
			if (id === 'c') return node;
			return { ...node, groupId: 'inner' };
		}),
		junctions: [],
		relations: [
			{ id: 'r2', from: 'b', to: 'c' },
			{ id: 'r1', from: 'a', to: 'c' },
			{ id: 'internal', from: 'a', to: 'b' },
		],
	};
}

describe('collapsed document provenance', () => {
	it('preserves every source relation and hidden member while exposing one canonical aggregate', async () => {
		const source = groupedDocument();
		const before = structuredClone(source);
		const projected = projectCollapsedDocument(source, ['outer', 'inner']);
		expect(projected.document.nodes.map(({ id }) => id)).toEqual(['c']);
		expect(projected.document.groups.map(({ id }) => id)).toEqual(['outer']);
		expect(projected.hiddenEndpointIds).toEqual(new Set(['inner', 'a', 'b']));
		expect(projected.document.relations).toEqual([{ id: 'r1', from: 'outer', to: 'c' }]);
		expect(projected.relations.get('r1')).toEqual({
			sourceRelationIds: ['r1', 'r2'],
			canChangeFrom: false,
			canChangeTo: false,
		});
		const prepared = await layoutDocument(projected.document);
		const canvas = createCanvasModel(
			createCanvasMeasurementModel(projected.document),
			prepared.layout,
			{
				document: projected.document,
				ranks: prepared.ranks,
				relationProjections: projected.relations,
			},
		);
		expect(canvas.relations[0]).toMatchObject({
			sourceRelationIds: ['r1', 'r2'],
			canChangeFrom: false,
			canChangeTo: false,
		});
		expect(source).toEqual(before);
		expect(collapsedDocument(source, []).nodes).toEqual(source.nodes);
		expect(projectCollapsedDocument(source, []).hiddenEndpointIds.size).toBe(0);
	});

	it('locks only the hidden endpoint of a single projected relation', () => {
		const source = groupedDocument();
		const projected = projectCollapsedDocument(
			{ ...source, relations: [{ id: 'into-group', from: 'c', to: 'a' }] },
			['inner'],
		);
		expect(projected.relations.get('into-group')).toEqual({
			sourceRelationIds: ['into-group'],
			canChangeFrom: true,
			canChangeTo: false,
		});
	});

	it('does not aggregate unrelated duplicate relations when only another part is collapsed', () => {
		const source = groupedDocument();
		const relations = [
			{ id: 'one', from: 'c', to: 'outer' },
			{ id: 'two', from: 'c', to: 'outer' },
		];
		const projected = projectCollapsedDocument({ ...source, relations }, ['inner']);
		expect(projected.document.relations).toEqual(relations);
		expect(projected.relations.get('two')?.sourceRelationIds).toEqual(['two']);
	});

	it('keeps geometry and provenance invariant under collection and collapse-order permutations', async () => {
		const document = groupedDocument();
		const original = projectCollapsedDocument(document, ['outer', 'inner']);
		const baseline = await layoutDocument(original.document);
		await fc.assert(
			fc.asyncProperty(
				fc.shuffledSubarray([...document.nodes], { minLength: 3, maxLength: 3 }),
				fc.shuffledSubarray([...document.groups], { minLength: 2, maxLength: 2 }),
				fc.shuffledSubarray([...document.relations], { minLength: 3, maxLength: 3 }),
				fc.shuffledSubarray(['outer', 'inner'], { minLength: 2, maxLength: 2 }),
				async (nodes, groups, relations, collapsed) => {
					const projected = projectCollapsedDocument(
						{ ...document, nodes, groups, relations },
						collapsed,
					);
					expect(projected.document.relations).toEqual(original.document.relations);
					expect(projected.relations).toEqual(original.relations);
					expect(projected.hiddenEndpointIds).toEqual(original.hiddenEndpointIds);
					expect((await layoutDocument(projected.document)).layout).toEqual(baseline.layout);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});
