import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { groupJunctionFixture } from '../../../support/fixtures/group-junction-fixture';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

function interleavedNestedGroupDocument(): LogicDocument {
	const base = groupJunctionFixture(
		{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		false,
		true,
	);
	return {
		...base,
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'inner',
				label: 'Inner',
				groupId: 'group',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Group,
				id: 'group',
				label: 'Group',
				layoutOrder: orderKey('a0'),
			},
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
			{
				kind: EndpointKind.Group,
				id: 'separate-inner',
				label: 'Separate inner',
				groupId: 'separate-group',
				layoutOrder: orderKey('a5'),
			},
			{
				kind: EndpointKind.Group,
				id: 'empty-inner',
				label: 'Empty inner',
				groupId: 'separate-group',
				layoutOrder: orderKey('a9'),
			},
		],
		nodes: [
			...base.nodes,
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
				groupId: 'separate-inner',
				layoutOrder: orderKey('a7'),
			},
		],
		relations: [
			...base.relations,
			{ id: 'chain-first-to-outside', from: 'chain-first', to: 'outside' },
			{ id: 'outside-to-chain-last', from: 'outside', to: 'chain-last' },
		],
	};
}

function packedNestedRootGroupsDocument(): LogicDocument {
	const base = groupJunctionFixture(
		{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		false,
		false,
	);
	const template = defined(base.nodes[0]);
	return {
		...base,
		groups: [
			{ kind: EndpointKind.Group, id: 'left-group', label: 'Left', layoutOrder: orderKey('a0') },
			{
				kind: EndpointKind.Group,
				id: 'left-inner',
				label: 'Left inner',
				groupId: 'left-group',
				layoutOrder: orderKey('a1'),
			},
			{ kind: EndpointKind.Group, id: 'right-group', label: 'Right', layoutOrder: orderKey('a2') },
			{
				kind: EndpointKind.Group,
				id: 'right-inner',
				label: 'Right inner',
				groupId: 'right-group',
				layoutOrder: orderKey('a3'),
			},
		],
		nodes: [
			{
				...template,
				id: 'first',
				markdown: 'First',
				groupId: 'left-group',
				layoutOrder: orderKey('a0'),
			},
			{
				...template,
				id: 'middle',
				markdown: 'Middle',
				groupId: 'right-inner',
				layoutOrder: orderKey('a1'),
			},
			{
				...template,
				id: 'last',
				markdown: 'Last',
				groupId: 'left-inner',
				layoutOrder: orderKey('a2'),
			},
		],
		junctions: [],
		relations: [
			{ id: 'first-middle', from: 'first', to: 'middle' },
			{ id: 'middle-last', from: 'middle', to: 'last' },
		],
	};
}

describe('dedicated layouts with nested group channels', () => {
	it('keeps interleaved shells together while a route leaves a nested group', () => {
		const document = interleavedNestedGroupDocument();
		const measurement = { minimumWidth: 240, minimumHeight: 180, headerHeight: 30, padding: 30 };
		const prepared = prepareLayoutDocument(document, {
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
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);

		const validation = validateDedicatedCandidate({ ...prepared, layout });
		expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
		const outer = layout.elements.find(({ id }) => id === 'separate-group')?.bounds;
		const inner = layout.elements.find(({ id }) => id === 'separate-inner')?.bounds;
		const nestedMember = layout.elements.find(({ id }) => id === 'chain-last')?.bounds;
		expect(outer).toBeDefined();
		expect(inner).toBeDefined();
		expect(nestedMember).toBeDefined();
		if (outer === undefined || inner === undefined || nestedMember === undefined) return;
		expect(inner.x).toBeGreaterThanOrEqual(outer.x);
		expect(inner.y).toBeGreaterThanOrEqual(outer.y);
		expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
		expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
		expect(nestedMember.x).toBeGreaterThan(inner.x);
		expect(nestedMember.y).toBeGreaterThan(inner.y);
	});

	it('moves nested shells with their interleaved sibling group', () => {
		const prepared = prepareLayoutDocument(packedNestedRootGroupsDocument(), {
			nodes: {
				first: { width: 100, height: 50 },
				middle: { width: 100, height: 50 },
				last: { width: 100, height: 50 },
			},
			groups: {
				'left-group': { minimumWidth: 140, minimumHeight: 100, headerHeight: 20, padding: 20 },
				'left-inner': { minimumWidth: 120, minimumHeight: 80, headerHeight: 20, padding: 10 },
				'right-group': { minimumWidth: 140, minimumHeight: 100, headerHeight: 20, padding: 20 },
				'right-inner': { minimumWidth: 120, minimumHeight: 80, headerHeight: 20, padding: 10 },
			},
		});
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		const validation = validateDedicatedCandidate({ ...prepared, layout });
		expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
		const bounds = new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
		const left = defined(bounds.get('left-group'));
		const right = defined(bounds.get('right-group'));
		const inner = defined(bounds.get('right-inner'));
		const middle = defined(bounds.get('middle'));
		expect(left.x + left.width <= right.x || right.x + right.width <= left.x).toBe(true);
		expect(inner.x).toBeGreaterThanOrEqual(right.x);
		expect(inner.x + inner.width).toBeLessThanOrEqual(right.x + right.width);
		expect(middle.x).toBeGreaterThan(inner.x);
		expect(middle.y).toBeGreaterThan(inner.y);
	});
});
