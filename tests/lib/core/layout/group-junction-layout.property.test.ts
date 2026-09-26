import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { groupSeparationWindows } from '../../../../src/lib/core/layout/placement/enclose-groups';
import { packGroupSiblings } from '../../../../src/lib/core/layout/placement/pack-group-siblings';
import {
	placeElements,
	type PlacementState,
} from '../../../../src/lib/core/layout/placement/place-elements';
import { prepareMeasurements } from '../../../../src/lib/core/layout/placement/prepare-measurements';
import { prepareGroupHierarchy } from '../../../../src/lib/core/layout/structure/group-hierarchy';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { groupJunctionFixture } from '../../../support/fixtures/group-junction-fixture';
import {
	boundsFor,
	contains,
	layoutDocument,
	overlaps,
	prepareLayoutDocument,
	progressesFromTo,
} from '../../../support/harnesses/layout';
import { VisualLayout } from '../../../support/harnesses/visual-layout';

function interleavedGroupJunctionFixture(
	configuration: (typeof LAYOUT_CONFIGURATIONS)[number],
	groupAsTarget: boolean,
	nested: boolean,
): LogicDocument {
	const document = groupJunctionFixture(configuration, groupAsTarget, nested);
	let lastGroupId = 'separate-group';
	if (nested) lastGroupId = 'separate-inner';
	let nestedGroups: LogicDocument['groups'] = [];
	if (nested)
		nestedGroups = [
			{
				kind: EndpointKind.Group,
				id: 'separate-inner',
				label: 'Separate inner group',
				groupId: 'separate-group',
				layoutOrder: orderKey('a5'),
			},
			{
				kind: EndpointKind.Group,
				id: 'empty-inner',
				label: 'Empty inner group',
				groupId: 'separate-group',
				layoutOrder: orderKey('a9'),
			},
		];
	const groups: LogicDocument['groups'] = [
		...document.groups,
		{
			kind: EndpointKind.Group,
			id: 'empty-group',
			label: 'Empty group',
			layoutOrder: orderKey('a8'),
		},
		{
			kind: EndpointKind.Group,
			id: 'separate-group',
			label: 'Separate group',
			layoutOrder: orderKey('a4'),
		},
		...nestedGroups,
	];
	return {
		...document,
		groups,
		nodes: [
			...document.nodes,
			{
				kind: EndpointKind.Node,
				id: 'chain-first',
				natureId: 'goal',
				markdown: 'First member',
				groupId: 'separate-group',
				layoutOrder: orderKey('a6'),
			},
			{
				kind: EndpointKind.Node,
				id: 'chain-last',
				natureId: 'goal',
				markdown: 'Last member',
				groupId: lastGroupId,
				layoutOrder: orderKey('a7'),
			},
		],
		relations: [
			...document.relations,
			{ id: 'chain-first-to-outside', from: 'chain-first', to: 'outside' },
			{ id: 'outside-to-chain-last', from: 'outside', to: 'chain-last' },
		],
	};
}

function isDescendant(
	document: ReturnType<typeof interleavedGroupJunctionFixture>,
	node: (typeof document.nodes)[number],
	groupId: string,
): boolean {
	const groups = new Map(document.groups.map((group) => [group.id, group]));
	let parentId = node.groupId;
	while (parentId !== undefined) {
		if (parentId === groupId) return true;
		parentId = groups.get(parentId)?.groupId;
	}
	return false;
}

describe.each(LAYOUT_CONFIGURATIONS)(
	'group boundaries at junctions in $direction / $bias',
	(configuration) => {
		it.each([false, true])(
			'keeps a populated group disjoint and attached on its principal face (target=%s)',
			async (groupAsTarget) => {
				const document = groupJunctionFixture(configuration, groupAsTarget, false);
				const result = await layoutDocument(document, {
					nodes: { member: { width: 100, height: 50 }, outside: { width: 100, height: 50 } },
					groups: {
						group: { minimumWidth: 140, minimumHeight: 100, headerHeight: 30, padding: 20 },
					},
				});
				const group = boundsFor(result.layout, 'group');
				const junction = boundsFor(result.layout, 'junction');
				expect(overlaps(group, junction)).toBe(false);
				let before = junction,
					after = group;
				if (groupAsTarget) [before, after] = [group, junction];
				expect(progressesFromTo(before, after, configuration.direction)).toBe(true);
				AssertLayout(
					new VisualLayout(result.layout, result.ranks.byEndpointId, configuration.direction),
				)
					.routes()
					.areOrthogonal()
					.areAttachedToEndpoints()
					.followLayoutFlow();
			},
		);
	},
);

it.each(LAYOUT_CONFIGURATIONS)(
	'keeps a junction linked to a member outside its group ($direction)',
	async (configuration) => {
		const fixture = groupJunctionFixture(configuration, false, false);
		const document: LogicDocument = {
			...fixture,
			nodes: fixture.nodes.filter(({ id }) => id === 'member'),
			relations: [{ id: 'junction-member', from: 'junction', to: 'member' }],
		};
		const { layout, ranks } = await layoutDocument(document, {
			nodes: { member: { width: 100, height: 50 } },
			groups: { group: { minimumWidth: 340, minimumHeight: 420, headerHeight: 35, padding: 48 } },
		});
		expect(overlaps(boundsFor(layout, 'group'), boundsFor(layout, 'junction'))).toBe(false);
		AssertLayout(new VisualLayout(layout, ranks.byEndpointId, configuration.direction))
			.routes()
			.areOrthogonal()
			.areAttachedToEndpoints();
	},
);

it.each(LAYOUT_CONFIGURATIONS)(
	'keeps reserved route endpoints on their final boxes ($direction)',
	async (configuration) => {
		const fixture = rankOrderComparisonCorpus().find(({ id }) => id === 'adjacent-2+2');
		if (fixture === undefined) throw new Error('Adjacent 2+2 document must exist');
		const group = groupJunctionFixture(configuration, false, false).groups[0];
		if (group === undefined) throw new Error('Group must exist');
		const document: LogicDocument = {
			...fixture.document,
			layout: configuration,
			groups: [group],
			nodes: fixture.document.nodes.map((node) => {
				if (node.id === 'd') return { ...node, groupId: 'group' };
				return node;
			}),
		};
		const { layout, ranks } = await layoutDocument(document, {
			groups: { group: { minimumWidth: 180, minimumHeight: 270, headerHeight: 48, padding: 26 } },
		});
		AssertLayout(new VisualLayout(layout, ranks.byEndpointId, configuration.direction))
			.routes()
			.areOrthogonal()
			.areAttachedToEndpoints();
	},
);

function groupForTallNode(id: string): string | undefined {
	if (id === 'a' || id === 'sink') return 'child';
	if (id === 'b') return 'parent';
	return undefined;
}

function tallNestedInterleaving(
	configuration: (typeof LAYOUT_CONFIGURATIONS)[number],
): LogicDocument {
	const base = groupJunctionFixture(configuration, false, true);
	const ids = ['n0', 'a', 'n1', 'b', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 'sink'];
	return {
		...base,
		groups: [
			{ kind: EndpointKind.Group, id: 'parent', label: 'Parent', layoutOrder: orderKey('a0') },
			{
				kind: EndpointKind.Group,
				id: 'child',
				groupId: 'parent',
				label: 'Child',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Group,
				id: 'empty',
				groupId: 'parent',
				label: 'Empty',
				layoutOrder: orderKey('a2'),
			},
		],
		nodes: ids.map((id, index) => {
			const node = {
				kind: EndpointKind.Node as const,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: orderKey(`b${String(index).padStart(2, '0')}`),
			};
			const groupId = groupForTallNode(id);
			if (groupId !== undefined) return { ...node, groupId };
			return node;
		}),
		junctions: [],
		relations: [
			...['n0', 'a', 'n1', 'b'].map((id) => ({ id: `${id}-sink`, from: id, to: 'sink' })),
			...Array.from({ length: 7 }, (_, index) => ({
				id: `t${index}-next`,
				from: `t${index}`,
				to: `t${index + 1}`,
			})),
			{ id: 't7-sink', from: 't7', to: 'sink' },
		],
	};
}

function groupContains(document: LogicDocument, ancestorId: string, memberId: string): boolean {
	const byId = new Map(document.groups.map((group) => [group.id, group]));
	let parentId = byId.get(memberId)?.groupId;
	while (parentId !== undefined) {
		if (parentId === ancestorId) return true;
		parentId = byId.get(parentId)?.groupId;
	}
	return false;
}

function assertDisjointNodesAndForeignGroups(
	document: LogicDocument,
	layout: Awaited<ReturnType<typeof layoutDocument>>['layout'],
): void {
	for (const group of document.groups) {
		for (const node of document.nodes) {
			if (isDescendant(document, node, group.id)) continue;
			expect(
				overlaps(boundsFor(layout, group.id), boundsFor(layout, node.id)),
				sourceLabel(group.id, node.id),
			).toBe(false);
		}
	}
	for (const [index, group] of document.groups.entries()) {
		for (const next of document.groups.slice(index + 1)) {
			if (groupContains(document, group.id, next.id)) continue;
			if (groupContains(document, next.id, group.id)) continue;
			expect(
				overlaps(boundsFor(layout, group.id), boundsFor(layout, next.id)),
				sourceLabel(group.id, next.id),
			).toBe(false);
		}
	}
	for (const [index, node] of document.nodes.entries()) {
		for (const next of document.nodes.slice(index + 1)) {
			expect(
				overlaps(boundsFor(layout, node.id), boundsFor(layout, next.id)),
				sourceLabel(node.id, next.id),
			).toBe(false);
		}
	}
}

function sourceLabel(left: string, right: string): string {
	return `${left} must not intersect ${right}`;
}

it.each(LAYOUT_CONFIGURATIONS)(
	'separates overlapping sibling frames even when neither contains the other source ($direction / $bias)',
	async (configuration) => {
		const fixture = groupJunctionFixture(configuration, false, false);
		const member = fixture.nodes.find(({ id }) => id === 'member');
		const sourceGroup = fixture.groups[0];
		if (member === undefined || sourceGroup === undefined)
			throw new Error('Group fixture requires member and group');
		const sink = { ...member, id: 'sink', layoutOrder: orderKey('a4') };
		delete sink.groupId;
		const document: LogicDocument = {
			...fixture,
			groups: [
				{ ...sourceGroup, id: 'left' },
				{ ...sourceGroup, id: 'right', layoutOrder: orderKey('a3') },
			],
			nodes: [
				{ ...member, id: 'a', groupId: 'left', layoutOrder: orderKey('a1') },
				{ ...member, id: 'b', groupId: 'right', layoutOrder: orderKey('a2') },
				sink,
			],
			junctions: [],
			relations: [
				{ id: 'a-sink', from: 'a', to: 'sink' },
				{ id: 'b-sink', from: 'b', to: 'sink' },
			],
		};
		const { layout, ranks } = await layoutDocument(document, {
			nodes: {
				a: { width: 100, height: 60 },
				b: { width: 100, height: 60 },
				sink: { width: 100, height: 60 },
			},
			groups: {
				left: { minimumWidth: 140, minimumHeight: 100, headerHeight: 20, padding: 20 },
				right: { minimumWidth: 140, minimumHeight: 100, headerHeight: 20, padding: 20 },
			},
		});
		assertDisjointNodesAndForeignGroups(document, layout);
		AssertLayout(new VisualLayout(layout, ranks.byEndpointId, configuration.direction))
			.routes()
			.areAttachedToEndpoints();
	},
);

it('keeps generated non-descendant nodes outside every group envelope', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...LAYOUT_CONFIGURATIONS),
			fc.boolean(),
			fc.boolean(),
			fc.record({
				minimumWidth: fc.integer({ min: 140, max: 600 }),
				minimumHeight: fc.integer({ min: 100, max: 600 }),
				headerHeight: fc.integer({ min: 5, max: 90 }),
				padding: fc.integer({ min: 5, max: 100 }),
			}),
			async (configuration, groupAsTarget, nested, measurement) => {
				const document = interleavedGroupJunctionFixture(configuration, groupAsTarget, nested);
				const { layout } = await layoutDocument(document, {
					nodes: {
						member: { width: 100, height: 50 },
						outside: { width: 100, height: 50 },
						'chain-first': { width: 100, height: 50 },
						'chain-last': { width: 100, height: 50 },
					},
					groups: {
						'empty-group': measurement,
						'empty-inner': measurement,
						group: measurement,
						inner: measurement,
						'separate-group': measurement,
						'separate-inner': measurement,
					},
				});
				for (const group of document.groups) {
					const groupBounds = boundsFor(layout, group.id);
					for (const node of document.nodes) {
						if (isDescendant(document, node, group.id)) continue;
						expect(
							overlaps(groupBounds, boundsFor(layout, node.id)),
							`${node.id} must stay outside group ${group.id} in ${configuration.direction}`,
						).toBe(false);
					}
				}
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it.each(LAYOUT_CONFIGURATIONS)(
	'separates tall nested, empty and interleaved groups across distant ranks ($direction / $bias)',
	async (configuration) => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 100, max: 230 }),
				fc.integer({ min: 35, max: 125 }),
				fc.boolean(),
				async (nodeWidth, padding, reverse) => {
					const document = tallNestedInterleaving(configuration);
					let variant = document;
					if (reverse)
						variant = {
							...document,
							groups: document.groups.toReversed(),
							nodes: document.nodes.toReversed(),
							relations: document.relations.toReversed(),
						};
					const overrides = {
						nodes: Object.fromEntries(
							document.nodes.map((node, index) => [
								node.id,
								{ width: nodeWidth + (index % 3) * 17, height: 45 + (index % 4) * 13 },
							]),
						),
						groups: {
							parent: { minimumWidth: 180, minimumHeight: 100, headerHeight: 35, padding },
							child: { minimumWidth: 10000, minimumHeight: 10000, headerHeight: 25, padding: 20 },
							empty: { minimumWidth: 140, minimumHeight: 110, headerHeight: 20, padding: 15 },
						},
					};
					const { layout, ranks } = await layoutDocument(variant, overrides);
					assertDisjointNodesAndForeignGroups(variant, layout);
					expect(
						(ranks.byEndpointId.get('t0') ?? 0) - (ranks.byEndpointId.get('sink') ?? 0),
					).toBeGreaterThanOrEqual(8);
					const parent = boundsFor(layout, 'parent');
					if (configuration.direction === LayoutDirection.TopToBottom) {
						const distant = boundsFor(layout, 't0');
						expect(parent.y).toBeLessThan(distant.y + distant.height);
						expect(distant.y).toBeLessThan(parent.y + parent.height);
					}
					expect(contains(parent, boundsFor(layout, 'child'))).toBe(true);
					expect(contains(boundsFor(layout, 'parent'), boundsFor(layout, 'empty'))).toBe(true);
					const { layout: reordered } = await layoutDocument(
						{
							...variant,
							groups: variant.groups.toReversed(),
							nodes: variant.nodes.toReversed(),
							relations: variant.relations.toReversed(),
						},
						overrides,
					);
					expect(reordered).toEqual(layout);
				},
			),
			PROPERTY_PARAMETERS,
		);
	},
);

it('keeps an unrelated six-rank chain aligned and its routes short after local separation', async () => {
	const configuration = LAYOUT_CONFIGURATIONS[0];
	const base = tallNestedInterleaving(configuration);
	const chain = Array.from({ length: 6 }, (_, index) => `u${index}`);
	const document: LogicDocument = {
		...base,
		nodes: [
			...base.nodes,
			...chain.map((id, index) => ({
				kind: EndpointKind.Node as const,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: orderKey(`b2${index}`),
			})),
		],
		relations: [
			...base.relations,
			...chain.slice(1).map((id, index) => {
				const target = chain[index];
				if (target === undefined) throw new Error('Chain predecessor must exist');
				return { id: `chain-${index}`, from: id, to: target };
			}),
		],
	};
	const baseline = await layoutDocument(document, {
		groups: {
			parent: { minimumWidth: 180, minimumHeight: 100, headerHeight: 35, padding: 35 },
			child: { minimumWidth: 220, minimumHeight: 100, headerHeight: 25, padding: 20 },
			empty: { minimumWidth: 140, minimumHeight: 110, headerHeight: 20, padding: 15 },
		},
	});
	const expanded = await layoutDocument(document, {
		groups: {
			parent: { minimumWidth: 180, minimumHeight: 100, headerHeight: 35, padding: 35 },
			child: { minimumWidth: 10000, minimumHeight: 10000, headerHeight: 25, padding: 20 },
			empty: { minimumWidth: 140, minimumHeight: 110, headerHeight: 20, padding: 15 },
		},
	});
	assertDisjointNodesAndForeignGroups(document, expanded.layout);
	const xs = chain.map((id) => boundsFor(expanded.layout, id).x);
	const baselineXs = chain.map((id) => boundsFor(baseline.layout, id).x);
	expect(
		Math.max(...xs) - Math.min(...xs) - (Math.max(...baselineXs) - Math.min(...baselineXs)),
	).toBeLessThan(36);
	const routeLength = (layout: typeof expanded.layout): number =>
		layout.relations
			.filter(({ id }) => id.startsWith('chain-'))
			.flatMap(({ points }) =>
				points.slice(1).map((point, index) => {
					const previous = points[index];
					if (previous === undefined) throw new Error('Every route segment has a predecessor');
					return Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
				}),
			)
			.reduce((sum, length) => sum + length, 0);
	expect(routeLength(expanded.layout) - routeLength(baseline.layout)).toBeLessThan(100);
	expect(expanded.layout.width - baseline.layout.width).toBeLessThan(10000);
});

it('reserves actual nested envelopes with varied minimum sizes, padding and header measurements', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...LAYOUT_CONFIGURATIONS),
			fc.boolean(),
			fc.record({
				minimumWidth: fc.integer({ min: 140, max: 600 }),
				minimumHeight: fc.integer({ min: 100, max: 600 }),
				headerHeight: fc.integer({ min: 5, max: 90 }),
				padding: fc.integer({ min: 5, max: 100 }),
			}),
			async (configuration, groupAsTarget, measurement) => {
				const document = groupJunctionFixture(configuration, groupAsTarget, true);
				const original = structuredClone(document);
				const overrides = { groups: { group: measurement, inner: measurement } };
				const { layout, ranks } = await layoutDocument(document, overrides);
				const group = boundsFor(layout, 'group');
				expect(overlaps(group, boundsFor(layout, 'junction'))).toBe(false);
				expect(overlaps(group, boundsFor(layout, 'outside'))).toBe(false);
				expect(contains(group, boundsFor(layout, 'inner'))).toBe(true);
				expect(contains(boundsFor(layout, 'inner'), boundsFor(layout, 'member'))).toBe(true);
				AssertLayout(new VisualLayout(layout, ranks.byEndpointId, configuration.direction))
					.routes()
					.areOrthogonal()
					.areAttachedToEndpoints()
					.followLayoutFlow();
				expect(
					(
						await layoutDocument(
							{
								...document,
								groups: document.groups.toReversed(),
								nodes: document.nodes.toReversed(),
								relations: document.relations.toReversed(),
							},
							overrides,
						)
					).layout,
				).toEqual(layout);
				expect(document).toEqual(original);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('keeps layered relations attached around a wide staggered group', async () => {
	const configuration = { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right } as const;
	const seed = groupJunctionFixture(configuration, false, false);
	const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
	const heights = [143, 41, 150, 63, 82, 70];
	const firstNode = seed.nodes[0];
	if (firstNode === undefined) throw new Error('Group fixture requires a node');
	const nodeTemplate = { ...firstNode };
	delete nodeTemplate.groupId;
	const document: LogicDocument = {
		...seed,
		nodes: ids.map((id, index) => {
			const node = { ...nodeTemplate, id, markdown: id, layoutOrder: orderKey(`a${index + 1}`) };
			if (index % 2 === 1) return { ...node, groupId: 'group' };
			return node;
		}),
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'join',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a8'),
			},
		],
		relations: [
			{ id: 'r-0-4', from: 'a', to: 'e' },
			{ id: 'r-1-2', from: 'b', to: 'c' },
			{ id: 'r-1-3', from: 'b', to: 'd' },
			{ id: 'r-3-5', from: 'd', to: 'f' },
			{ id: 'r-4-5', from: 'e', to: 'f' },
			{ id: 'j-a', from: 'join', to: 'a' },
		],
	};
	const { layout, ranks } = await layoutDocument(document, {
		nodes: Object.fromEntries(
			ids.map((id, index) => {
				const height = heights[index];
				if (height === undefined) throw new Error('Every node needs a measured height');
				return [id, { width: 133, height }];
			}),
		),
		groups: { group: { minimumWidth: 1085, minimumHeight: 1085, headerHeight: 68, padding: 103 } },
	});
	assertDisjointNodesAndForeignGroups(document, layout);
	expect(overlaps(boundsFor(layout, 'group'), boundsFor(layout, 'join'))).toBe(false);
	AssertLayout(new VisualLayout(layout, ranks.byEndpointId, configuration.direction))
		.routes()
		.areOrthogonal()
		.areAttachedToEndpoints()
		.followLayoutFlow()
		.haveOnlyAllowedSharedTrunks();
});

it('keeps all ordinary routes attached when grouped packing increases a corridor gap', async () => {
	const configuration = { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left } as const;
	const seed = groupJunctionFixture(configuration, false, false);
	const firstNode = seed.nodes[0];
	if (firstNode === undefined) throw new Error('Group fixture requires a node');
	const nodeTemplate = { ...firstNode };
	delete nodeTemplate.groupId;
	const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
	const sizes = [
		{ width: 158, height: 80 },
		{ width: 148, height: 112 },
		{ width: 184, height: 42 },
		{ width: 83, height: 77 },
		{ width: 165, height: 62 },
		{ width: 145, height: 125 },
	];
	const document: LogicDocument = {
		...seed,
		nodes: ids.map((id, index) => {
			const node = { ...nodeTemplate, id, markdown: id, layoutOrder: orderKey(`a${index + 1}`) };
			if (id === 'd' || id === 'f') return { ...node, groupId: 'group' };
			return node;
		}),
		junctions: [],
		relations: [
			{ id: 'r0-2', from: 'a', to: 'c' },
			{ id: 'r1-4', from: 'b', to: 'e' },
			{ id: 'r2-3', from: 'c', to: 'd' },
			{ id: 'r2-4', from: 'c', to: 'e' },
		],
	};
	const { layout, ranks } = await layoutDocument(document, {
		nodes: Object.fromEntries(
			ids.map((id, index) => {
				const size = sizes[index];
				if (size === undefined) throw new Error('Every node requires dimensions');
				return [id, size];
			}),
		),
		groups: { group: { minimumWidth: 322, minimumHeight: 322, headerHeight: 91, padding: 61 } },
	});
	assertDisjointNodesAndForeignGroups(document, layout);
	AssertLayout(new VisualLayout(layout, ranks.byEndpointId, configuration.direction))
		.routes()
		.areOrthogonal()
		.areAttachedToEndpoints()
		.followLayoutFlow()
		.haveOnlyAllowedSharedTrunks();
});

it('keeps every relation attached when port growth exposes an independent corridor', async () => {
	const configuration = { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Right } as const;
	const fixture = groupJunctionFixture(configuration, false, false);
	const template = fixture.nodes[0];
	if (template === undefined) throw new Error('A group member is required');
	const ungrouped = { ...template };
	delete ungrouped.groupId;
	const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
	const sizes = [
		{ width: 167, height: 129 },
		{ width: 86, height: 46 },
		{ width: 151, height: 124 },
		{ width: 122, height: 103 },
		{ width: 126, height: 80 },
		{ width: 135, height: 42 },
	];
	const document: LogicDocument = {
		...fixture,
		nodes: ids.map((id, index) => {
			const node = { ...ungrouped, id, markdown: id, layoutOrder: orderKey(`a${index + 1}`) };
			if (id === 'f') return { ...node, groupId: 'group' };
			return node;
		}),
		junctions: [],
		relations: [
			{ id: 'a-d', from: 'a', to: 'd' },
			{ id: 'b-e', from: 'b', to: 'e' },
			{ id: 'b-f', from: 'b', to: 'f' },
			{ id: 'c-e', from: 'c', to: 'e' },
			{ id: 'c-f', from: 'c', to: 'f' },
		],
	};
	const { layout, ranks } = await layoutDocument(document, {
		nodes: Object.fromEntries(
			ids.map((id, index) => {
				const size = sizes[index];
				if (size === undefined) throw new Error('Every node requires dimensions');
				return [id, size];
			}),
		),
		groups: { group: { minimumWidth: 327, minimumHeight: 327, headerHeight: 53, padding: 40 } },
	});
	assertDisjointNodesAndForeignGroups(document, layout);
	const newCorridor = layout.relations.find((route) => route.id === 'a-d');
	const reusableRail = layout.relations.find((route) => route.id === 'c-e');
	if (newCorridor === undefined || reusableRail === undefined)
		throw new Error('The independent and reusable routes must exist');
	// The independent link enters the allocated corridor instead of creating a private rail.
	expect(newCorridor.points[1]?.x).toBe(reusableRail.points[1]?.x);
	AssertLayout(new VisualLayout(layout, ranks.byEndpointId, configuration.direction))
		.routes()
		.areOrthogonal()
		.areAttachedToEndpoints()
		.followLayoutFlow()
		.haveOnlyAllowedSharedTrunks();
});

it('separates a group from a junction retreating as trailing clearance grows from 48 to 96', () => {
	const configuration = { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left } as const;
	const fixture = groupJunctionFixture(configuration, false, false);
	const group = fixture.groups[0];
	if (group === undefined) throw new Error('Group fixture requires its primary group');
	const document: LogicDocument = {
		...fixture,
		groups: [group, { ...group, id: 'wide', layoutOrder: orderKey('a4') }],
		nodes: fixture.nodes.map((node) => {
			if (node.id === 'outside') return { ...node, groupId: 'wide' };
			return node;
		}),
		relations: [
			{ id: 'junction-member', from: 'junction', to: 'member' },
			{ id: 'outside-junction', from: 'outside', to: 'junction' },
		],
	};
	const prepared = prepareLayoutDocument(document, {
		nodes: { member: { width: 100, height: 60 }, outside: { width: 100, height: 60 } },
		junctions: { junction: { width: 20, height: 20 } },
		groups: {
			group: { minimumWidth: 174, minimumHeight: 100, headerHeight: 0, padding: 20 },
			wide: { minimumWidth: 100, minimumHeight: 100, headerHeight: 0, padding: 140 },
		},
	});
	const structure = prepareLayout(prepared.graph, prepared.ranks);
	const frame = createLayoutFrame(configuration.direction, configuration.bias);
	const measurements = prepareMeasurements(structure, prepared.measurements, frame);
	expect(measurements.rankGap).toBe(140);
	const placement: PlacementState = {
		bounds: new Map(),
		components: [],
		groupChannelInsets: new Map(),
	};
	const workspace = { structure, frame, measurements, placement };
	placeElements(workspace, new Map(), new Map([[0, [48, 48]]]));
	const firstGroup = placement.bounds.get('group');
	const firstJunction = placement.bounds.get('junction');
	const firstMember = placement.bounds.get('member');
	if (firstGroup === undefined || firstJunction === undefined || firstMember === undefined)
		throw new Error('First group and junction must be placed');
	expect(overlaps(firstGroup, firstJunction)).toBe(false);
	const firstJunctionStart = firstJunction.x;
	expect(firstJunctionStart - firstMember.x - firstMember.width).toBe(60);
	placeElements(workspace, new Map(), new Map([[0, [48, 96]]]));
	const finalGroup = placement.bounds.get('group');
	const finalJunction = placement.bounds.get('junction');
	const finalMember = placement.bounds.get('member');
	if (finalGroup === undefined || finalJunction === undefined || finalMember === undefined)
		throw new Error('Final group and junction must be placed');
	expect(finalJunction.x - finalMember.x - finalMember.width).toBe(48);
	expect(firstJunctionStart - finalJunction.x).toBe(12);
	expect(overlaps(finalGroup, finalJunction)).toBe(false);
});

it('propagates a junction retreat through nested shells', () => {
	const bounds = new Map([
		['foreign', { x: 0, y: 40, width: 100, height: 140 }],
		['junction', { x: 160, y: 100, width: 20, height: 20 }],
		['inner', { x: 105, y: 45, width: 130, height: 130 }],
		['outer', { x: 100, y: 40, width: 140, height: 140 }],
	]);
	const seed = groupJunctionFixture(
		{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		false,
		false,
	);
	const group = seed.groups[0];
	const junction = seed.junctions[0];
	if (group === undefined || junction === undefined) throw new Error('Expected group and junction');
	const hierarchy = prepareGroupHierarchy({
		...seed,
		nodes: [],
		groups: [
			{ ...group, id: 'inner', groupId: 'outer' },
			{ ...group, id: 'outer' },
		],
		junctions: [{ ...junction, groupId: 'inner' }],
	});
	if (hierarchy === undefined) throw new Error('Expected nested groups');
	const windows = groupSeparationWindows(bounds, false, new Map([['junction', 12]]), hierarchy);
	expect(windows.get('inner')).toEqual({ first: 93, last: 247 });
	expect(windows.get('outer')).toEqual({ first: 88, last: 252 });
	const initial = structuredClone(bounds);
	packGroupSiblings(
		['foreign', 'outer'],
		bounds,
		{ groupIds: hierarchy.byId, pending: new Map(), windows },
		false,
	);
	const outer = bounds.get('outer');
	const foreign = bounds.get('foreign');
	if (outer === undefined || foreign === undefined) throw new Error('Expected both boxes');
	outer.x -= 12;
	expect(overlaps(outer, foreign)).toBe(false);
	fc.assert(
		fc.property(fc.integer({ min: 0, max: 40 }), (retreat) => {
			const boxes = structuredClone(initial);
			const reserved = groupSeparationWindows(
				boxes,
				false,
				new Map([['junction', retreat]]),
				hierarchy,
			);
			packGroupSiblings(
				['foreign', 'outer'],
				boxes,
				{ groupIds: hierarchy.byId, pending: new Map(), windows: reserved },
				false,
			);
			const container = boxes.get('outer');
			const outsider = boxes.get('foreign');
			if (container === undefined || outsider === undefined)
				throw new Error('Expected both packed boxes');
			container.x -= retreat;
			expect(overlaps(container, outsider)).toBe(false);
		}),
		PROPERTY_PARAMETERS,
	);
});

it.each(LAYOUT_CONFIGURATIONS)(
	'validates junction-only nested shells under asymmetric channel growth (%s)',
	(configuration) => {
		const seed = groupJunctionFixture(configuration, false, false);
		const node = seed.nodes[0];
		const junction = seed.junctions[0];
		const group = seed.groups[0];
		if (node === undefined || junction === undefined || group === undefined)
			throw new Error('Expected the grouped junction fixture');
		const ungrouped = { ...node };
		delete ungrouped.groupId;
		const document: LogicDocument = {
			...seed,
			groups: [
				{ ...group, id: 'inner', groupId: 'outer' },
				{ ...group, id: 'outer' },
				{ ...group, id: 'wide' },
			],
			nodes: [
				{ ...ungrouped, id: 'source', groupId: 'wide' },
				{ ...ungrouped, id: 'foreign', layoutOrder: orderKey('a4') },
				{ ...ungrouped, id: 'target', layoutOrder: orderKey('a5') },
			],
			junctions: [{ ...junction, groupId: 'inner' }],
			relations: [
				{ id: 'source-join', from: 'source', to: 'junction' },
				{ id: 'foreign-join', from: 'foreign', to: 'junction' },
				{ id: 'join-target', from: 'junction', to: 'target' },
			],
		};
		const prepared = prepareLayoutDocument(document, {
			nodes: {
				source: { width: 100, height: 60 },
				foreign: { width: 100, height: 60 },
				target: { width: 100, height: 60 },
			},
			junctions: { junction: { width: 20, height: 20 } },
			groups: {
				inner: { minimumWidth: 130, minimumHeight: 130, headerHeight: 0, padding: 55 },
				outer: { minimumWidth: 140, minimumHeight: 140, headerHeight: 0, padding: 0 },
				wide: { minimumWidth: 140, minimumHeight: 140, headerHeight: 0, padding: 85 },
			},
		});
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
		expect(overlaps(boundsFor(layout, 'outer'), boundsFor(layout, 'foreign'))).toBe(false);
	},
);
