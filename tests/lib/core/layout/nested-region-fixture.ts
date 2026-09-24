import {
	defined,
	EndpointKind,
	LaneGrowth,
	LaneOrientation,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { solveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-layout';
import {
	type NestedRegionInput,
	NestedRegionLayoutStatus,
	type NestedRegionSelected,
} from '../../../../src/lib/core/layout/nested-region-types';
import {
	type PreparedLayoutDocument,
	prepareLayoutDocument,
} from '../../../support/harnesses/layout';

export function regionDocument(crossFrom = 'a-target'): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'nested-region-case',
		title: 'Nested regions',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'a-source',
				natureId: 'task',
				markdown: 'A source\n',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 'a-target',
				natureId: 'task',
				markdown: 'A target\n',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Node,
				id: 'b',
				natureId: 'task',
				markdown: 'B\n',
				layoutOrder: orderKey('a2'),
			},
			{
				kind: EndpointKind.Node,
				id: 'c',
				natureId: 'task',
				markdown: 'C\n',
				layoutOrder: orderKey('a3'),
			},
		],
		relations: [
			{ id: 'inside-a', from: 'a-source', to: 'a-target' },
			{ id: 'across-middle', from: crossFrom, to: 'c' },
		],
	};
}

export function nestedRegionInput(): NestedRegionInput {
	return {
		regions: [
			{ id: '@root', layoutOrder: '0' },
			{ id: 'left', parentId: '@root', layoutOrder: 'a' },
			{ id: 'middle', parentId: '@root', layoutOrder: 'b' },
			{
				id: 'right',
				parentId: '@root',
				layoutOrder: 'c',
				layout: {
					direction: LayoutDirection.RightToLeft,
					bias: LayoutBias.Right,
				},
			},
		],
		regionByEndpointId: new Map([
			['a-source', 'left'],
			['a-target', 'left'],
			['b', 'middle'],
			['c', 'right'],
		]),
	};
}

/** Two LCAs: one inside a nested parent, one at the virtual root. */
export function depthTwoRegionDocument(): LogicDocument {
	const source = regionDocument();
	const template = defined(source.nodes.find(({ id }) => id === 'c'));
	return {
		...source,
		nodes: [
			...source.nodes,
			{ ...template, id: 'd', markdown: 'D\n', layoutOrder: orderKey('a4') },
			{ ...template, id: 'e', markdown: 'E\n', layoutOrder: orderKey('a5') },
		],
		relations: [
			defined(source.relations.find(({ id }) => id === 'inside-a')),
			{ id: 'inside-branch', from: 'a-target', to: 'c' },
			{ id: 'at-root', from: 'd', to: 'e' },
		],
	};
}

export function depthTwoRegionInput(): NestedRegionInput {
	return {
		regions: [
			{ id: '@root', layoutOrder: '0' },
			{ id: 'branch', parentId: '@root', layoutOrder: 'a' },
			{ id: 'right', parentId: '@root', layoutOrder: 'b' },
			{ id: 'far-right', parentId: '@root', layoutOrder: 'c' },
			{ id: 'left', parentId: 'branch', layoutOrder: 'a' },
			{ id: 'middle', parentId: 'branch', layoutOrder: 'b' },
			{ id: 'branch-right', parentId: 'branch', layoutOrder: 'c' },
		],
		regionByEndpointId: new Map([
			['a-source', 'left'],
			['a-target', 'left'],
			['b', 'middle'],
			['c', 'branch-right'],
			['d', 'right'],
			['e', 'far-right'],
		]),
	};
}

type PersistedRegionDocument = LogicDocument & {
	readonly regionPresentation: NonNullable<LogicDocument['regionPresentation']>;
};

export function persistedRegionDocument(source = regionDocument()): PersistedRegionDocument {
	const assignments = nestedRegionInput().regionByEndpointId;
	return {
		...source,
		persistenceFormat: REGION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_PRESENTATION_SCHEMA,
			regions: [
				{
					id: 'left',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'middle',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'right',
					layoutOrder: orderKey('a2'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		nodes: source.nodes.map((node) => ({
			...node,
			regionId: defined(assignments.get(node.id)),
		})),
	};
}

export function persistedDepthTwoRegionDocument(
	source = depthTwoRegionDocument(),
): PersistedRegionDocument {
	const assignments = depthTwoRegionInput().regionByEndpointId;
	return {
		...source,
		persistenceFormat: REGION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_PRESENTATION_SCHEMA,
			regions: [
				{
					id: 'branch',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'right',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'far-right',
					layoutOrder: orderKey('a2'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'left',
					parentId: 'branch',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'middle',
					parentId: 'branch',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'branch-right',
					parentId: 'branch',
					layoutOrder: orderKey('a2'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		nodes: source.nodes.map((node) => ({
			...node,
			regionId: defined(assignments.get(node.id)),
		})),
	};
}

/** A persisted grid inside a region tree, with an ordinary root sibling. */
export function persistedNestedGridDocument(): PersistedRegionDocument {
	const source = regionDocument();
	const template = defined(source.nodes.find(({ id }) => id === 'c'));
	const ownership = new Map([
		['a-source', 'a'],
		['a-target', 'a'],
		['b', 'b'],
		['c', 'c'],
		['d', 'd'],
		['outside', 'outside'],
	]);
	return {
		...source,
		persistenceFormat: REGION_COMPOSITION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
			regions: [
				{
					id: 'grid',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
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
				{
					id: 'outside',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
				...(['a', 'b', 'c', 'd'] as const).map((id, index) => ({
					id,
					parentId: 'grid',
					layoutOrder: orderKey(`a${index}`),
					policy: LayoutPolicy.Layered,
				})),
			],
		},
		nodes: [
			...source.nodes,
			{ ...template, id: 'd', markdown: 'D\n', layoutOrder: orderKey('a4') },
			{
				...template,
				id: 'outside',
				markdown: 'Outside\n',
				layoutOrder: orderKey('a5'),
			},
		].map((node) => ({ ...node, regionId: defined(ownership.get(node.id)) })),
		relations: [
			{ id: 'inside-a', from: 'a-source', to: 'a-target' },
			{ id: 'across-grid', from: 'a-target', to: 'd' },
		],
	};
}

/** Two disjoint top exits use opposite grid columns and separate outer leaves. */
export function persistedNestedGridWithTwoOuterIncidentsDocument(): PersistedRegionDocument {
	const source = persistedNestedGridDocument();
	const outside = defined(source.nodes.find(({ id }) => id === 'outside'));
	return {
		...source,
		regionPresentation: {
			...source.regionPresentation,
			regions: [
				...source.regionPresentation.regions.map((region) => {
					if (region.id === 'outside') return { ...region, layoutOrder: orderKey('a2') };
					return region;
				}),
				{
					id: 'outside-2',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		nodes: [
			...source.nodes,
			{
				...outside,
				id: 'outside-2',
				markdown: 'Outside 2\n',
				regionId: 'outside-2',
				layoutOrder: orderKey('a6'),
			},
		],
		relations: [
			defined(source.relations.find(({ id }) => id === 'inside-a')),
			{ id: 'z-left-exit', from: 'a-target', to: 'outside' },
			{ id: 'a-right-exit', from: 'b', to: 'outside-2' },
		],
	};
}

/** Direct group portal owned by an internal grid, with no incident at the grid boundary. */
export function persistedNestedGridWithGroupPortalDocument(): PersistedRegionDocument {
	const source = persistedNestedGridDocument();
	return {
		...source,
		groups: [
			...source.groups,
			{
				kind: EndpointKind.Group,
				id: 'cell-group',
				label: 'Cell group',
				regionId: 'b',
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: source.nodes.map((node) => {
			if (node.id !== 'b') return node;
			const member = { ...node, groupId: 'cell-group' };
			delete member.regionId;
			return member;
		}),
		relations: [
			...source.relations.filter(({ id }) => id !== 'across-grid'),
			{ id: 'group-crossing', from: 'cell-group', to: 'd' },
		],
	};
}

/** One grid cell uses a shared lane leaf while another pair keeps an intercell route. */
export function persistedNestedGridWithLaneCellDocument(): PersistedRegionDocument {
	const source = persistedNestedGridDocument();
	const b = defined(source.nodes.find(({ id }) => id === 'b'));
	return {
		...source,
		regionPresentation: {
			...source.regionPresentation,
			regions: source.regionPresentation.regions.map((region) => {
				if (region.id !== 'b') return region;
				return {
					...region,
					lanePresentation: {
						laneOrientation: LaneOrientation.Parallel,
						growth: LaneGrowth.Auto,
						lanes: [
							{ id: 'left', label: 'Left', layoutOrder: orderKey('a0') },
							{ id: 'right', label: 'Right', layoutOrder: orderKey('a1') },
						],
					},
				};
			}),
		},
		nodes: [
			...source.nodes.map((node) => {
				if (node.id !== 'b') return node;
				return { ...node, laneId: 'left' };
			}),
			{
				...b,
				id: 'b2',
				markdown: 'B2\n',
				layoutOrder: orderKey('a6'),
				laneId: 'right',
			},
		],
		relations: [...source.relations, { id: 'inside-b', from: 'b', to: 'b2' }],
	};
}

/** The right lane of cell b has one direct crossing to the cell below it. */
export function persistedNestedGridWithLaneCrossingDocument(): PersistedRegionDocument {
	const source = persistedNestedGridWithLaneCellDocument();
	return {
		...source,
		relations: [
			...source.relations.filter(({ id }) => id !== 'across-grid'),
			{ id: 'leaves-b', from: 'b2', to: 'd' },
		],
	};
}

/** The left lane's source crosses its sibling lane before leaving the grid cell. */
export function persistedNestedGridWithInnerLaneCrossingDocument(): PersistedRegionDocument {
	const source = persistedNestedGridWithLaneCellDocument();
	return {
		...source,
		relations: [
			...source.relations.filter(({ id }) => id !== 'across-grid'),
			{ id: 'leaves-b', from: 'b', to: 'd' },
		],
	};
}

export function selectedNestedRegionLayout(
	document = regionDocument(),
	regions = nestedRegionInput(),
): {
	readonly prepared: PreparedLayoutDocument;
	readonly result: NestedRegionSelected;
} {
	const prepared = prepareLayoutDocument(document);
	const result = solveNestedRegionLayout(prepared.graph, prepared.measurements, regions);
	if (result.status !== NestedRegionLayoutStatus.Selected)
		throw new Error(`Expected selected nested layout, got ${result.status}: ${result.reason}`);
	return { prepared, result };
}
