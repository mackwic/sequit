import { describe, expect, it } from 'vitest';

import { normalizeLayoutGraph } from '../../../../../src/app/workshop/visual-tests/solver-prototype/normalized-graph';
import { projectCollapsedDocument } from '../../../../../src/lib/core/document/collapsed-document';
import {
	EndpointKind,
	GroupState,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../../src/lib/core/graph/create-graph';

function foldedDocument(): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'normalized-folded-group',
		title: 'B → x → A, with A and B in G',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [
			{
				id: 'G',
				kind: EndpointKind.Group,
				label: 'G',
				state: GroupState.Closed,
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: [
			{
				id: 'A',
				kind: EndpointKind.Node,
				natureId: 'task',
				groupId: 'G',
				markdown: 'A',
				layoutOrder: orderKey('a1'),
			},
			{
				id: 'B',
				kind: EndpointKind.Node,
				natureId: 'task',
				groupId: 'G',
				markdown: 'B',
				layoutOrder: orderKey('a2'),
			},
			{
				id: 'x',
				kind: EndpointKind.Node,
				natureId: 'task',
				markdown: 'x',
				layoutOrder: orderKey('a3'),
			},
		],
		junctions: [],
		relations: [
			{ id: 'B-to-x', from: 'B', to: 'x' },
			{ id: 'x-to-A', from: 'x', to: 'A' },
		],
	};
}

describe('normalized layout graph', () => {
	it('keeps source anchors separate when a visible group creates a false cycle', () => {
		const document = foldedDocument();
		expect(createGraph(document).ok).toBe(true);
		expect(createGraph(projectCollapsedDocument(document, ['G']).document).ok).toBe(false);

		const result = normalizeLayoutGraph(document, ['G']);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.visibleOwners).toEqual([
			{ id: 'G', sourceEndpointIds: ['A', 'B', 'G'] },
			{ id: 'x', sourceEndpointIds: ['x'] },
		]);
		expect(result.value.relations).toEqual([
			{
				id: 'B-to-x',
				from: { endpointId: 'B', visibleOwnerId: 'G' },
				to: { endpointId: 'x', visibleOwnerId: 'x' },
			},
			{
				id: 'x-to-A',
				from: { endpointId: 'x', visibleOwnerId: 'x' },
				to: { endpointId: 'A', visibleOwnerId: 'G' },
			},
		]);
	});

	it('is independent of document collection order', () => {
		const document = foldedDocument();
		const permuted: LogicDocument = {
			...document,
			groups: document.groups.toReversed(),
			nodes: document.nodes.toReversed(),
			relations: document.relations.toReversed(),
		};
		expect(normalizeLayoutGraph(permuted, ['G'])).toEqual(normalizeLayoutGraph(document, ['G']));
	});

	it('uses the outermost collapsed owner without losing a nested source anchor', () => {
		const document = foldedDocument();
		const group = document.groups[0];
		if (group === undefined) throw new Error('Missing fixture group');
		const nested: LogicDocument = {
			...document,
			groups: [
				{
					id: 'H',
					kind: EndpointKind.Group,
					label: 'H',
					state: GroupState.Closed,
					layoutOrder: orderKey('a0'),
				},
				{ ...group, groupId: 'H' },
			],
		};
		const result = normalizeLayoutGraph(nested, ['G', 'H']);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.visibleOwners).toEqual([
			{ id: 'H', sourceEndpointIds: ['A', 'B', 'G', 'H'] },
			{ id: 'x', sourceEndpointIds: ['x'] },
		]);
		expect(result.value.relations[0]?.from).toEqual({ endpointId: 'B', visibleOwnerId: 'H' });
		expect(result.value.relations[1]?.to).toEqual({ endpointId: 'A', visibleOwnerId: 'H' });
	});

	it('rejects a real source cycle before applying visible ownership', () => {
		const document = foldedDocument();
		const cyclic: LogicDocument = {
			...document,
			relations: [...document.relations, { id: 'A-to-B', from: 'A', to: 'B' }],
		};
		const result = normalizeLayoutGraph(cyclic, ['G']);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.diagnostics[0]?.code).toBe('cycle');
	});
});
