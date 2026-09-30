import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	type LayoutConfiguration,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { isVerticalDirection } from '../../../../src/lib/core/layout/geometry/layout-frame';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { GROUP_FRAME_CLEARANCE } from '../../../../src/lib/core/layout/layout-settings';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { groupJunctionFixture } from '../../../support/fixtures/group-junction-fixture';
import {
	boundsFor,
	contains,
	layoutDocument,
	overlaps,
	prepareLayoutDocument,
} from '../../../support/harnesses/layout';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';
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

	it.each(Object.values(LayoutDirection))(
		'materializes three concurrent shortcut routes within their shared group frame in %s',
		(direction) => {
			const vertical =
				direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
			const base = groupJunctionFixture(
				defined(layoutConfiguration(direction, defaultBiasFor(direction))),
				false,
				false,
			);
			const template = defined(base.nodes[0]);
			const document: LogicDocument = {
				...base,
				groups: [
					{ kind: EndpointKind.Group, id: 'common', label: 'Common', layoutOrder: orderKey('a0') },
				],
				nodes: ['source', 'middle', 'target'].map((id, index) => ({
					...template,
					id,
					markdown: id,
					groupId: 'common',
					layoutOrder: orderKey(`a${index + 1}`),
				})),
				junctions: [],
				relations: [
					{ id: 'source-middle', from: 'source', to: 'middle' },
					{ id: 'middle-target', from: 'middle', to: 'target' },
					{ id: 'shortcut-a', from: 'source', to: 'target' },
					{ id: 'shortcut-b', from: 'source', to: 'target' },
					{ id: 'shortcut-c', from: 'source', to: 'target' },
				],
			};
			const sourceSize = { width: 40, height: 80 };
			const middleSize = { width: 40, height: 500 };
			const groupSize = { minimumWidth: 700, minimumHeight: 800 };
			if (vertical) {
				sourceSize.width = 80;
				sourceSize.height = 40;
				middleSize.width = 500;
				middleSize.height = 40;
				groupSize.minimumWidth = 800;
				groupSize.minimumHeight = 700;
			}
			const prepared = prepareLayoutDocument(document, {
				nodes: {
					source: sourceSize,
					middle: middleSize,
					target: sourceSize,
				},
				groups: {
					common: {
						...groupSize,
						headerHeight: 24,
						padding: 16,
					},
				},
			});
			const layout = layoutWithDedicatedEngine(
				prepared.graph,
				prepared.ranks,
				prepared.measurements,
			);
			const validation = validateDedicatedCandidate({ ...prepared, layout });
			expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
			const group = defined(layout.elements.find(({ id }) => id === 'common'));
			const routes = new Map(layout.relations.map((route) => [route.id, route]));
			for (const id of ['shortcut-a', 'shortcut-b', 'shortcut-c']) {
				const route = defined(routes.get(id));
				expect(route.points.length).toBeGreaterThan(2);
				expect(
					route.points.every(
						({ x, y }) =>
							x >= group.bounds.x &&
							x <= group.bounds.x + group.bounds.width &&
							y >= group.bounds.y &&
							y <= group.bounds.y + group.bounds.height,
					),
				).toBe(true);
			}
		},
	);
});

describe('rank gaps holding group frame shells', () => {
	it.each(LAYOUT_CONFIGURATIONS)(
		'keeps a frame ending on a junction member clear of the facing row ($direction / $bias)',
		async (configuration) => {
			const document = { ...validLogicDocument(), layout: configuration };
			const { layout, ranks } = await layoutDocument(document, {
				nodes: {
					'source-a': { width: 121, height: 54 },
					'source-b': { width: 124, height: 122 },
					target: { width: 6, height: 5 },
					isolated: { width: 93, height: 55 },
				},
				junctions: { choice: { width: 257, height: 102 } },
				groups: {
					container: { minimumWidth: 82, minimumHeight: 86, headerHeight: 47, padding: 43 },
					'endpoint-group': { minimumWidth: 116, minimumHeight: 248, headerHeight: 15, padding: 2 },
					'orphan-group': { minimumWidth: 162, minimumHeight: 356, headerHeight: 44, padding: 11 },
				},
			});
			AssertLayout(
				new VisualLayout(layout, ranks.byEndpointId, configuration.direction, undefined, document),
			)
				.group('container')
				.isClearOfForeignBoxes({ along: 48, across: 36 });
		},
	);

	it.each(LAYOUT_CONFIGURATIONS)(
		'keeps a one-rank frame grown by a nested minimum size clear of the next row ($direction / $bias)',
		async (configuration) => {
			const node = { kind: EndpointKind.Node, natureId: 'goal' } as const;
			const document: LogicDocument = {
				...validLogicDocument(),
				layout: configuration,
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
				nodes: [
					{
						...node,
						id: 'member',
						markdown: 'Member',
						groupId: 'inner',
						layoutOrder: orderKey('a2'),
					},
					{ ...node, id: 'outside', markdown: 'Outside', layoutOrder: orderKey('a3') },
				],
				junctions: [],
				relations: [{ id: 'outside-member', from: 'outside', to: 'member' }],
			};
			const { layout, ranks } = await layoutDocument(document, {
				nodes: { member: { width: 60, height: 40 }, outside: { width: 60, height: 40 } },
				groups: {
					outer: { minimumWidth: 420, minimumHeight: 420, headerHeight: 20, padding: 20 },
					inner: { minimumWidth: 300, minimumHeight: 300, headerHeight: 20, padding: 20 },
				},
			});
			AssertLayout(
				new VisualLayout(layout, ranks.byEndpointId, configuration.direction, undefined, document),
			)
				.group('outer')
				.isClearOfForeignBoxes({ along: 48, across: 36 });
		},
	);

	function mainGap(layout: LayoutResult, ids: readonly [string, string]): number {
		const [left, right] = ids.map((id) => {
			const { x, width } = boundsFor(layout, id);
			return { start: x, end: x + width };
		});
		if (left === undefined || right === undefined) throw new Error('Expected two boxes');
		return Math.max(left.start - right.end, right.start - left.end);
	}

	function chainDocument(
		configuration: LayoutConfiguration,
		members: readonly string[],
		chain: readonly string[],
	): LogicDocument {
		const node = { kind: EndpointKind.Node, natureId: 'goal' } as const;
		return {
			...validLogicDocument(),
			layout: configuration,
			groups: [{ kind: EndpointKind.Group, id: 'g', label: 'G', layoutOrder: orderKey('a0') }],
			nodes: chain.map((id, index) => {
				const entry = { ...node, id, markdown: id, layoutOrder: orderKey(`a${index + 1}`) };
				if (members.includes(id)) return { ...entry, groupId: 'g' };
				return entry;
			}),
			junctions: [],
			relations: chain.slice(1).map((id, index) => {
				const to = defined(chain[index]);
				return { id: `${id}-${to}`, from: id, to };
			}),
		};
	}

	it.each(LAYOUT_CONFIGURATIONS.filter(({ direction }) => !isVerticalDirection(direction)))(
		'reserves no transverse header along a horizontal flow ($direction / $bias)',
		async (configuration) => {
			const document = chainDocument(configuration, ['member'], ['outside', 'member']);
			const { layout } = await layoutDocument(document, {
				nodes: { member: { width: 60, height: 40 }, outside: { width: 60, height: 40 } },
				groups: { g: { minimumWidth: 60, minimumHeight: 60, headerHeight: 30, padding: 40 } },
			});
			expect(mainGap(layout, ['g', 'outside'])).toBe(GROUP_FRAME_CLEARANCE);
		},
	);

	it.each(LAYOUT_CONFIGURATIONS)(
		'reserves a nested multi-rank minimum size in the rank gap it faces ($direction / $bias)',
		async (configuration) => {
			const base = chainDocument(configuration, [], ['p', 'a', 'b', 'c']);
			const inner = {
				kind: EndpointKind.Group,
				id: 'inner',
				label: 'Inner',
				groupId: 'g',
			} as const;
			const document: LogicDocument = {
				...base,
				groups: [...base.groups, { ...inner, layoutOrder: orderKey('a5') }],
				nodes: base.nodes.map((node) => {
					if (node.id === 'a' || node.id === 'b') return { ...node, groupId: 'inner' };
					return node;
				}),
			};
			let tall = { minimumWidth: 160, minimumHeight: 600 };
			if (!isVerticalDirection(configuration.direction))
				tall = { minimumWidth: 600, minimumHeight: 90 };
			const size = { width: 100, height: 60 };
			const { layout, ranks } = await layoutDocument(document, {
				nodes: { p: size, a: size, b: size, c: size },
				groups: {
					g: { minimumWidth: 60, minimumHeight: 60, headerHeight: 30, padding: 20 },
					inner: { ...tall, headerHeight: 42, padding: 24 },
				},
			});
			const check = AssertLayout(
				new VisualLayout(layout, ranks.byEndpointId, configuration.direction, undefined, document),
			);
			check.group('g').isClearOfForeignBoxes({ along: GROUP_FRAME_CLEARANCE, across: 36 });
			// Neither neighbour is pushed aside: the overflow lies along the flow, whichever its side,
			// and the families stay centered, the block with its parent and the child under its own.
			check.envelope(['g']).isCenteredOn('p', { axis: 'transverse' });
			check.node('c').isCenteredOn('b', { axis: 'transverse' });
		},
	);
});
