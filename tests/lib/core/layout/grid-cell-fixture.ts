import {
	EndpointKind,
	GRID_PERSISTENCE_FORMAT,
	GRID_REGION_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type { GridCellInput } from '../../../../src/lib/core/layout/grid-cell-types';
import {
	type PreparedLayoutDocument,
	prepareLayoutDocument,
} from '../../../support/harnesses/layout';

export function gridDocument(): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'grid-proof',
		title: 'Grid composition proof',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'oversized',
				label: 'Indivisible',
				layoutOrder: orderKey('a0'),
			},
		],
		junctions: [],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'a-top',
				natureId: 'task',
				markdown: 'A top\n',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 'a-bottom',
				natureId: 'task',
				markdown: 'A bottom\n',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Node,
				id: 'b',
				natureId: 'task',
				markdown: 'B\n',
				groupId: 'oversized',
				layoutOrder: orderKey('a2'),
			},
			{
				kind: EndpointKind.Node,
				id: 'c',
				natureId: 'task',
				markdown: 'C\n',
				layoutOrder: orderKey('a3'),
			},
			{
				kind: EndpointKind.Node,
				id: 'd',
				natureId: 'task',
				markdown: 'D\n',
				layoutOrder: orderKey('a4'),
			},
		],
		relations: [
			{ id: 'inside-a', from: 'a-bottom', to: 'a-top' },
			{ id: 'across-grid', from: 'a-bottom', to: 'd' },
		],
	};
}

export function gridInput(): GridCellInput {
	return {
		rootId: '@root',
		cells: [
			{ id: 'a', parentId: '@root', row: 0, column: 0 },
			{
				id: 'b',
				parentId: '@root',
				row: 0,
				column: 1,
				layout: { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
			},
			{ id: 'c', parentId: '@root', row: 1, column: 0 },
			{ id: 'd', parentId: '@root', row: 1, column: 1 },
		],
		cellByEndpointId: new Map([
			['a-top', 'a'],
			['a-bottom', 'a'],
			['oversized', 'b'],
			['b', 'b'],
			['c', 'c'],
			['d', 'd'],
		]),
		minimumColumnWidths: [700, 100],
		minimumRowHeights: [50, 300],
	};
}

export function persistedGridDocument(): LogicDocument {
	const document = gridDocument();
	return {
		...document,
		persistenceFormat: GRID_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: GRID_REGION_PRESENTATION_SCHEMA,
			regions: ['a', 'b', 'c', 'd'].map((id, index) => ({
				id,
				layoutOrder: orderKey(`a${index}`),
				policy: LayoutPolicy.Layered,
			})),
			grid: {
				minimumColumnWidths: [700, 100],
				minimumRowHeights: [50, 300],
				cells: [
					{ regionId: 'a', row: 0, column: 0 },
					{ regionId: 'b', row: 0, column: 1 },
					{ regionId: 'c', row: 1, column: 0 },
					{ regionId: 'd', row: 1, column: 1 },
				],
			},
		},
		groups: document.groups.map((group) => ({ ...group, regionId: 'b' })),
		nodes: document.nodes.map((node) => {
			if (node.groupId !== undefined) return node;
			let regionId = 'a';
			if (node.id === 'c') regionId = 'c';
			if (node.id === 'd') regionId = 'd';
			return { ...node, regionId };
		}),
	};
}

export function prepareGrid(document = gridDocument()): PreparedLayoutDocument {
	return prepareLayoutDocument(document, {
		groups: { oversized: { minimumWidth: 620, minimumHeight: 320, headerHeight: 36, padding: 24 } },
	});
}
