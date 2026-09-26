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
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { groupJunctionFixture } from '../../../support/fixtures/group-junction-fixture';
import {
	boundsFor,
	contains,
	layoutDocument,
	overlaps,
	prepareLayoutDocument,
} from '../../../support/harnesses/layout';
import { VisualLayout } from '../../../support/harnesses/visual-layout';

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

function groupTargetMultiDepthDocument(): LogicDocument {
	const base = groupJunctionFixture(
		{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		true,
		false,
	);
	const junction = defined(base.junctions[0]);
	return {
		...base,
		junctions: [
			{ ...junction, id: 'near', layoutOrder: orderKey('a3') },
			{ ...junction, id: 'far', layoutOrder: orderKey('a4') },
		],
		relations: [
			{ id: 'outside-near', from: 'outside', to: 'near' },
			{ id: 'far-near', from: 'far', to: 'near' },
			{ id: 'near-group', from: 'near', to: 'group' },
		],
	};
}

describe('dedicated layouts with nested group channels', () => {
	it('keeps nested shells clear of external nodes and junctions', async () => {
		const configuration = {
			direction: LayoutDirection.LeftToRight,
			bias: LayoutBias.Left,
		} as const;
		const document = groupJunctionFixture(configuration, false, true);
		const measurement = { minimumWidth: 240, minimumHeight: 180, headerHeight: 30, padding: 30 };
		const { layout, ranks } = await layoutDocument(document, {
			nodes: {
				member: { width: 100, height: 50 },
				outside: { width: 100, height: 50 },
			},
			groups: { group: measurement, inner: measurement },
		});
		const group = boundsFor(layout, 'group');
		const inner = boundsFor(layout, 'inner');
		expect(contains(group, inner)).toBe(true);
		expect(contains(inner, boundsFor(layout, 'member'))).toBe(true);
		expect(overlaps(group, boundsFor(layout, 'junction'))).toBe(false);
		expect(overlaps(group, boundsFor(layout, 'outside'))).toBe(false);
		AssertLayout(new VisualLayout(layout, ranks.byEndpointId, configuration.direction))
			.routes()
			.areOrthogonal()
			.areAttachedToEndpoints()
			.followLayoutFlow();
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

	it('keeps a grouped junction incident clear within a multi-depth channel', () => {
		const prepared = prepareLayoutDocument(groupTargetMultiDepthDocument(), {
			nodes: { member: { width: 120, height: 60 }, outside: { width: 100, height: 60 } },
			junctions: {
				near: { width: 24, height: 24 },
				far: { width: 24, height: 24 },
			},
			groups: { group: { minimumWidth: 140, minimumHeight: 100, headerHeight: 0, padding: 0 } },
		});
		const structure = prepareLayout(prepared.graph, prepared.ranks);
		const nearPlacement = defined(structure.junctions.get('near'));
		const farPlacement = defined(structure.junctions.get('far'));
		expect(nearPlacement.interval).toBe(farPlacement.interval);
		expect(nearPlacement.depth).not.toBe(farPlacement.depth);
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		const validation = validateDedicatedCandidate({ ...prepared, layout });
		expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
	});
});
