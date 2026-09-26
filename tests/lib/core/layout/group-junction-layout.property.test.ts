import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { EndpointKind, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { groupJunctionFixture } from '../../../support/fixtures/group-junction-fixture';
import {
	boundsFor,
	contains,
	layoutDocument,
	overlaps,
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

it('keeps an empty group document on the no-separation path', async () => {
	const configuration = LAYOUT_CONFIGURATIONS[0];
	const fixture = groupJunctionFixture(configuration, false, false);
	const group = fixture.groups[0];
	if (group === undefined) throw new Error('The empty-group fixture needs a group');
	const document: LogicDocument = {
		...fixture,
		groups: [{ ...group, id: 'empty-group' }],
		nodes: [],
		junctions: [],
		relations: [],
	};
	const { layout } = await layoutDocument(document);
	const bounds = boundsFor(layout, 'empty-group');
	expect(bounds.width).toBeGreaterThan(0);
	expect(bounds.height).toBeGreaterThan(0);
	expect(layout.elements).toHaveLength(1);
});

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
