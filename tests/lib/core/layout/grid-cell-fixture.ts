import {
	EndpointKind,
	GRID_PERSISTENCE_FORMAT,
	GRID_REGION_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type {
	GridCellDefinition,
	GridCellInput,
} from '../../../../src/lib/core/layout/grids/grid-cell-types';
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
				layout: {
					direction: LayoutDirection.RightToLeft,
					bias: LayoutBias.Right,
				},
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
		groups: {
			oversized: {
				minimumWidth: 620,
				minimumHeight: 320,
				headerHeight: 36,
				padding: 24,
			},
		},
	});
}

interface NxmShape {
	readonly ids: readonly string[];
	readonly columns: number;
	readonly minimumColumnWidths: readonly number[];
	readonly minimumRowHeights: readonly number[];
	readonly relations: readonly {
		readonly id: string;
		readonly from: string;
		readonly to: string;
	}[];
}

const NXM_3X2: NxmShape = {
	ids: ['a', 'b', 'c', 'd', 'e', 'f'],
	columns: 3,
	minimumColumnWidths: [180, 120, 140],
	minimumRowHeights: [70, 90],
	relations: [
		{ id: 'a-b', from: 'a', to: 'b' },
		{ id: 'a-c', from: 'a', to: 'c' },
		{ id: 'c-f', from: 'c', to: 'f' },
	],
};

const NXM_2X3: NxmShape = {
	ids: ['a', 'b', 'c', 'd', 'e', 'f'],
	columns: 2,
	minimumColumnWidths: [180, 160],
	minimumRowHeights: [70, 90, 80],
	relations: [
		{ id: 'a-b', from: 'a', to: 'b' },
		{ id: 'a-e', from: 'a', to: 'e' },
		{ id: 'f-b', from: 'f', to: 'b' },
	],
};

function nxmCells(shape: NxmShape): readonly GridCellDefinition[] {
	return shape.ids.map((id, index) => ({
		id,
		parentId: '@root',
		row: Math.floor(index / shape.columns),
		column: index % shape.columns,
	}));
}

function nxmDocument(shape: NxmShape, id: string, title: string): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id,
		title,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes: shape.ids.map((nodeId, index) => ({
			kind: EndpointKind.Node,
			id: nodeId,
			natureId: 'task',
			markdown: `${nodeId}\n`,
			layoutOrder: orderKey(`a${index}`),
		})),
		relations: shape.relations.map(({ id: relationId, from, to }) => ({
			id: relationId,
			from,
			to,
		})),
	};
}

/** A three column by two row grid proof: three columns and two rows of independent cells. */
export function nxmThreeByTwoDocument(): LogicDocument {
	return nxmDocument(NXM_3X2, 'nxm-three-by-two', 'Three by two grid proof');
}

export function nxmThreeByTwoInput(): GridCellInput {
	return {
		rootId: '@root',
		cells: nxmCells(NXM_3X2),
		cellByEndpointId: new Map(NXM_3X2.ids.map((id) => [id, id])),
		minimumColumnWidths: NXM_3X2.minimumColumnWidths,
		minimumRowHeights: NXM_3X2.minimumRowHeights,
	};
}

/** A two column by three row grid proof: two columns and three rows of independent cells. */
export function nxmTwoByThreeDocument(): LogicDocument {
	return nxmDocument(NXM_2X3, 'nxm-two-by-three', 'Two by three grid proof');
}

export function nxmTwoByThreeInput(): GridCellInput {
	return {
		rootId: '@root',
		cells: nxmCells(NXM_2X3),
		cellByEndpointId: new Map(NXM_2X3.ids.map((id) => [id, id])),
		minimumColumnWidths: NXM_2X3.minimumColumnWidths,
		minimumRowHeights: NXM_2X3.minimumRowHeights,
	};
}

/** The three by two grid at the persisted root, for round trips and the browser proof. */
export function persistedNxmGridDocument(): LogicDocument {
	const shape = NXM_3X2;
	const document = nxmDocument(shape, 'nxm-grid-proof', 'Persisted three by two grid');
	return {
		...document,
		persistenceFormat: GRID_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: GRID_REGION_PRESENTATION_SCHEMA,
			regions: shape.ids.map((id, index) => ({
				id,
				layoutOrder: orderKey(`a${index}`),
				policy: LayoutPolicy.Layered,
			})),
			grid: {
				minimumColumnWidths: shape.minimumColumnWidths,
				minimumRowHeights: shape.minimumRowHeights,
				cells: shape.ids.map((regionId, index) => ({
					regionId,
					row: Math.floor(index / shape.columns),
					column: index % shape.columns,
				})),
			},
		},
		nodes: document.nodes.map((node) => ({ ...node, regionId: node.id })),
	};
}

/** A three by two grid nested in a region tree, with one incident from its middle column outwards. */
export function persistedNxmInnerGridDocument(): LogicDocument {
	const shape = NXM_3X2;
	const document = nxmDocument(shape, 'nxm-inner-grid-proof', 'Persisted inner three by two grid');
	return {
		...document,
		persistenceFormat: REGION_COMPOSITION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
			regions: [
				{
					id: 'grid',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
					grid: {
						minimumColumnWidths: shape.minimumColumnWidths,
						minimumRowHeights: shape.minimumRowHeights,
						cells: shape.ids.map((regionId, index) => ({
							regionId,
							row: Math.floor(index / shape.columns),
							column: index % shape.columns,
						})),
					},
				},
				{
					id: 'outside',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
				...shape.ids.map((id, index) => ({
					id,
					parentId: 'grid',
					layoutOrder: orderKey(`a${index}`),
					policy: LayoutPolicy.Layered,
				})),
			],
		},
		nodes: [
			...document.nodes.map((node) => ({ ...node, regionId: node.id })),
			{
				kind: EndpointKind.Node,
				id: 'outside',
				natureId: 'task',
				markdown: 'Outside\n',
				layoutOrder: orderKey('a6'),
				regionId: 'outside',
			},
		],
		relations: [{ id: 'b-out', from: 'b', to: 'outside' }],
	};
}
