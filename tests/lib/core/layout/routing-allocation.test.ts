import { describe, expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import { RoutingPortRole } from '../../../../src/lib/core/layout/layout-types';
import { allocateChannelIntervals } from '../../../../src/lib/core/layout/routing/channel-interval-allocation';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import {
	allocatePorts,
	PortMetricDemandKind,
	sharedSourcePorts,
	sharedTargetPorts,
} from '../../../../src/lib/core/layout/routing/port-allocation';
import {
	cornerPortSharing,
	crossingCorridors,
} from '../../../../src/lib/core/layout/routing/routing-corridors';
import { settleGroupCorridorPorts } from '../../../../src/lib/core/layout/routing/settle-group-corridors';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { groupJunctionFixture } from '../../../support/fixtures/group-junction-fixture';
import { boundsFor, contains, layoutDocument, overlaps } from '../../../support/harnesses/layout';
import { VisualLayout } from '../../../support/harnesses/visual-layout';

describe('rail and port reservations', () => {
	it('preserves face order from crossing corridors, including direct-link fallback', () => {
		const base = validLogicDocument();
		const document = {
			...base,
			groups: [],
			junctions: [],
			nodes: base.nodes.map((node) => {
				const ordinary = { ...node };
				delete ordinary.groupId;
				return ordinary;
			}),
			relations: ['source-a', 'source-b'].flatMap((from) =>
				['target', 'isolated'].map((to) => ({ id: `${from}-${to}`, from, to })),
			),
		};
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected a valid crossing graph');
		const firstRelation = graph.value.relations[0];
		if (firstRelation === undefined) throw new Error('Expected a relation to duplicate');
		const duplicateGraph = {
			...graph.value,
			relations: [firstRelation, ...graph.value.relations],
		};
		const ranks = new Map<string, number>([
			['source-a', 1],
			['source-b', 1],
			['target', 0],
			['isolated', 0],
		]);
		for (const vertical of [true, false])
			for (const reversed of [true, false]) {
				let targetCross = 100;
				let isolatedCross = 0;
				if (reversed) {
					targetCross = 0;
					isolatedCross = 100;
				}
				const transverse = new Map<string, number>([
					['source-a', 0],
					['source-b', 100],
					['target', targetCross],
					['isolated', isolatedCross],
				]);
				const bounds = new Map(
					[...transverse].map(([id, cross]) => {
						let main = 0;
						if (ranks.get(id) === 1) main = 120;
						let box = { x: cross, y: main, width: 80, height: 60 };
						if (!vertical) box = { x: main, y: cross, width: 60, height: 80 };
						return [id, box] as const;
					}),
				);
				const corridors = crossingCorridors({ graph: graph.value, ranks, bounds, vertical });
				expect(corridors.length).toBeGreaterThan(0);
				const sizes = new Map(
					[...bounds].map(([id, box]) => [id, { width: box.width, height: box.height }] as const),
				);
				const compare = (links: typeof corridors) => {
					const input = { corridors: links, sizes, vertical, graph: graph.value, bounds };
					expect(allocatePorts({ ...input, fromCrossingCorridors: true })).toEqual(
						allocatePorts(input),
					);
				};
				compare(corridors);
				const duplicateInput = {
					corridors: crossingCorridors({ graph: duplicateGraph, ranks, bounds, vertical }),
					sizes,
					vertical,
					graph: duplicateGraph,
					bounds,
				};
				expect(allocatePorts({ ...duplicateInput, fromCrossingCorridors: true })).toEqual(
					allocatePorts(duplicateInput),
				);
				compare(
					corridors.map((corridor) => ({
						...corridor,
						links: corridor.links.filter(({ relation }) => relation.id !== 'source-a-isolated'),
					})),
				);
			}
	});
	it('exposes face capacity before applying its size demand in either orientation', () => {
		const document = {
			...validLogicDocument(),
			relations: ['source-a', 'source-b', 'isolated'].map((from) => ({
				id: `${from}-target`,
				from,
				to: 'target',
			})),
		};
		const result = createGraph(document);
		if (!result.ok) throw new Error('The port capacity fixture must be a valid graph.');
		const links = result.value.relations.map(({ relation }, index) => ({
			relation,
			source: index * 48,
			target: 0,
		}));
		const bounds = new Map<string, Bounds>([
			['source-a', { x: 0, y: 100, width: 80, height: 60 }],
			['source-b', { x: 48, y: 100, width: 80, height: 60 }],
			['isolated', { x: 96, y: 100, width: 80, height: 60 }],
			['target', { x: 48, y: 0, width: 80, height: 60 }],
		]);
		for (const vertical of [true, false]) {
			const sizes = new Map(
				['source-a', 'source-b', 'isolated', 'target'].map(
					(id) => [id, { width: 80, height: 80 }] as const,
				),
			);
			const allocation = allocatePorts({
				corridors: [{ rank: 0, links }],
				sizes,
				vertical,
				graph: result.value,
				bounds,
			});
			const permuted = allocatePorts({
				corridors: [{ rank: 0, links: links.toReversed() }],
				sizes,
				vertical,
				graph: result.value,
				bounds,
			});
			expect(permuted.metricDemands).toEqual(allocation.metricDemands);
			expect(allocation.metricDemands).toContainEqual({
				kind: PortMetricDemandKind.FaceCapacity,
				endpointId: 'target',
				role: RoutingPortRole.Incoming,
				portCount: 3,
				minimumCrossSize: 144,
			});
			let expected = { width: 80, height: 144 };
			if (vertical) expected = { width: 144, height: 80 };
			expect(allocation.sizes.get('target')).toEqual(expected);
			expect(sizes.get('target')).toEqual({ width: 80, height: 80 });
		}
	});
	it.each(LAYOUT_CONFIGURATIONS)(
		'separates the common aligned link at its target in $direction with $bias bias',
		({ direction, bias }) => {
			const base = validLogicDocument();
			const template = base.nodes[0];
			if (template === undefined) throw new Error('Expected a fixture node');
			const ids = ['a', 'b', 'd', 'e'] as const;
			const document = {
				...base,
				groups: [],
				junctions: [],
				nodes: ids.map((id, index) => ({
					...template,
					id,
					layoutOrder: orderKey(`a${index + 1}`),
				})),
				relations: [
					{ id: 'a-d', from: 'a', to: 'd' },
					{ id: 'b-d', from: 'b', to: 'd' },
					{ id: 'b-e', from: 'b', to: 'e' },
				],
			};
			const result = createGraph(document);
			if (!result.ok) throw new Error('Expected a valid partial bipartite graph');
			const graph = result.value;
			const frame = createLayoutFrame(direction, bias);
			const reverse =
				direction === LayoutDirection.BottomToTop || direction === LayoutDirection.RightToLeft;
			const bounds = new Map<string, Bounds>();
			for (const [id, cross, source] of [
				['a', 100, true],
				['b', 200, true],
				['d', 200, false],
				['e', 300, false],
			] as const) {
				let main = 200;
				if (source === reverse) main = 0;
				let box: Bounds = { x: cross - 40, y: main, width: 80, height: 60 };
				if (!frame.vertical) box = { x: main, y: cross - 40, width: 60, height: 80 };
				bounds.set(id, box);
			}
			const ranks = new Map([
				['a', 1],
				['b', 1],
				['d', 0],
				['e', 0],
			]);
			const corridors = crossingCorridors({ graph, ranks, bounds, vertical: frame.vertical });
			expect(corridors).toMatchObject([{ cornerOnly: true }]);
			const sizes = new Map(
				[...bounds].map(([id, box]) => [id, { width: box.width, height: box.height }] as const),
			);
			const ports = allocatePorts({
				graph,
				bounds,
				vertical: frame.vertical,
				sizes,
				corridors,
				...cornerPortSharing(corridors),
			});
			expect(ports.sourceOffsets.get('b-d')).toBe(0);
			expect(ports.sourceOffsets.get('b-e')).toBe(0);
			expect(ports.targetOffsets.get('a-d')).toBe(-24);
			expect(ports.targetOffsets.get('b-d')).toBe(24);
		},
	);
	it('preserves a grouped fork and its face size when placement exposes a corner corridor', () => {
		const base = validLogicDocument();
		const target = base.nodes.find(({ id }) => id === 'target');
		if (target === undefined) throw new Error('The fixture requires a target node');
		const document = {
			...base,
			nodes: [...base.nodes, { ...target, id: 'target-c', layoutOrder: orderKey('a8') }],
			junctions: [],
			relations: [
				{ id: 'fork-a', from: 'source-a', to: 'target' },
				{ id: 'fork-b', from: 'source-a', to: 'isolated' },
				{ id: 'independent', from: 'source-b', to: 'target-c' },
			],
		};
		const graphResult = createGraph(document);
		if (!graphResult.ok) throw new Error('Expected a valid grouped fork graph');
		const graph = graphResult.value;
		const ranks = new Map([
			['source-a', 1],
			['source-b', 1],
			['target', 0],
			['isolated', 0],
			['target-c', 0],
		]);
		const bounds = new Map<string, Bounds>([
			['source-a', { x: 0, y: 100, width: 48, height: 80 }],
			['source-b', { x: 130, y: 100, width: 80, height: 80 }],
			['target', { x: 30, y: 0, width: 80, height: 80 }],
			['isolated', { x: 70, y: 0, width: 80, height: 80 }],
			['target-c', { x: 170, y: 0, width: 80, height: 80 }],
		]);
		const sizes = new Map(
			[...bounds].map(([id, box]) => [id, { width: box.width, height: box.height }]),
		);
		const input = { graph, ranks, bounds, vertical: true, sizes };
		const initial = crossingCorridors(input);
		expect(initial).toEqual([]);
		const initialPorts = allocatePorts({ ...input, corridors: initial });
		// Packing the group moves its member and the far leaf into the fork's transverse run.
		bounds.set('source-b', { x: 50, y: 100, width: 80, height: 80 });
		bounds.set('target-c', { x: 100, y: 0, width: 80, height: 80 });
		expect(crossingCorridors(input)).toMatchObject([{ cornerOnly: true }]);
		let placements = 0;
		const settled = settleGroupCorridorPorts({
			...input,
			initial,
			initialPorts,
			place(ports) {
				placements += 1;
				for (const [id, size] of ports.sizes) {
					const box = bounds.get(id);
					if (box !== undefined) bounds.set(id, { ...box, width: size.width });
				}
			},
		});
		expect(placements).toBe(1);
		expect(settled.ports.sourceOffsets.get('fork-a')).toBe(0);
		expect(settled.ports.sourceOffsets.get('fork-b')).toBe(0);
		expect(settled.ports.sizes.get('source-a')?.width).toBe(48);
		expect(bounds.get('source-a')?.width).toBe(48);

		// A second group movement can turn the same face request into a true crossing.
		bounds.set('target-c', { x: -10, y: 0, width: 80, height: 80 });
		expect(crossingCorridors(input)[0]?.cornerOnly).toBeUndefined();
		const crossed = settleGroupCorridorPorts({
			...input,
			initial: settled.corridors,
			initialPorts: settled.ports,
			place(ports) {
				const box = bounds.get('source-a');
				const size = ports.sizes.get('source-a');
				if (box !== undefined && size !== undefined)
					bounds.set('source-a', { ...box, width: size.width });
			},
		});
		expect(crossed.ports.sourceOffsets.get('fork-a')).toBe(-24);
		expect(crossed.ports.sourceOffsets.get('fork-b')).toBe(24);
		expect(crossed.ports.sizes.get('source-a')?.width).toBe(96);
	});
	it('keeps a grouped link attached when face growth opens an independent corridor', async () => {
		const direction = LayoutDirection.LeftToRight;
		const fixture = groupJunctionFixture({ direction, bias: LayoutBias.Right }, false, false);
		const template = fixture.nodes[0];
		if (template === undefined) throw new Error('A group member is required');
		const ungrouped = { ...template };
		delete ungrouped.groupId;
		const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
		// Documentary slots and sizes where a-d crosses no corridor in the first placement; only
		// the grouped placement after port growth opens its own corridor, which reuses the rails.
		const slots = [6, 4, 1, 3, 2, 5];
		const sizes = [
			{ width: 42, height: 80 },
			{ width: 153, height: 49 },
			{ width: 41, height: 55 },
			{ width: 43, height: 41 },
			{ width: 167, height: 43 },
			{ width: 67, height: 85 },
		];
		const document = {
			...fixture,
			nodes: ids.map((id, index) => {
				const slot = slots[index];
				if (slot === undefined) throw new Error('Every node requires a documentary slot');
				const node = { ...ungrouped, id, markdown: id, layoutOrder: orderKey(`a${slot}`) };
				if (id === 'c' || id === 'f') return { ...node, groupId: 'group' };
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
			groups: { group: { minimumWidth: 48, minimumHeight: 262, headerHeight: 2, padding: 1 } },
		});
		const group = boundsFor(layout, 'group');
		for (const id of ['c', 'f']) expect(contains(group, boundsFor(layout, id))).toBe(true);
		for (const id of ['a', 'b', 'd', 'e'])
			expect(overlaps(group, boundsFor(layout, id)), `Group must not contain ${id}`).toBe(false);
		const independent = layout.relations.find(({ id }) => id === 'a-d');
		// The group block takes its first member's documentary slot, ahead of b and e; the rail
		// between b and the block is then the one the late corridor reuses.
		const reusable = layout.relations.find(({ id }) => id === 'b-f');
		if (independent === undefined || reusable === undefined)
			throw new Error('Both routes must be materialized');
		expect(independent.points[1]?.x).toBe(reusable.points[1]?.x);
		AssertLayout(new VisualLayout(layout, ranks.byEndpointId, direction))
			.routes()
			.areOrthogonal()
			.areAttachedToEndpoints()
			.followLayoutFlow()
			.haveOnlyAllowedSharedTrunks();
	});

	it('ignores cached measurements for nodes no longer present in the document', async () => {
		const fixture = await layoutDocument({
			...validLogicDocument(),
			junctions: [],
			relations: ['source-a', 'source-b'].flatMap((from) =>
				['target', 'isolated'].map((to) => ({ id: `${from}-${to}`, from, to })),
			),
		});
		const measured = {
			...fixture.measurements,
			nodes: new Map(fixture.measurements.nodes).set('removed-node', { width: 1000, height: 1000 }),
		};
		expect(await layoutGraph(fixture.graph, fixture.ranks, measured)).toEqual(fixture.layout);
	});
	it('reuses a rail for separated intervals but reserves different rails for nested intervals', () => {
		const edge = { ownerId: '@root/channel/reuse', capacity: 4, spacing: 24 };
		const allocation = allocateChannelIntervals(
			edge,
			[
				{ key: 'outer', start: 0, end: 100, rail: -1 },
				{ key: 'inner', start: 0, end: 20, rail: -1 },
				{ key: 'later', start: 33, end: 50, rail: -1 },
			],
			2,
		);
		expect(allocation.trackCount).toBe(2);
		expect([...allocation.trackByRunKey]).toEqual([
			['inner', 2],
			['outer', 3],
			['later', 2],
		]);
	});
	it('keeps stable start/end ties and reuses the earliest released rail, not the lowest index', () => {
		const allocation = allocateChannelIntervals(
			{ ownerId: '@root/channel/ties', capacity: 6, spacing: 24 },
			[
				{ key: 'z-last', start: 0, end: 40, rail: -1 },
				{ key: 'a-first', start: 0, end: 40, rail: -1 },
				{ key: 'short', start: 0, end: 20, rail: -1 },
				{ key: 'middle', start: 33, end: 35, rail: -1 },
				{ key: 'later', start: 60, end: 80, rail: -1 },
				{ key: 'latest', start: 61, end: 75, rail: -1 },
			],
			2,
		);
		expect(allocation.trackCount).toBe(3);
		expect([...allocation.trackByRunKey]).toEqual([
			['short', 2],
			['z-last', 3],
			['a-first', 4],
			['middle', 2],
			['later', 2],
			['latest', 4],
		]);
	});
	it('selects the earliest released rail when two different rails are already free', () => {
		const allocation = allocateChannelIntervals(
			{ ownerId: '@root/channel/free', capacity: 4, spacing: 24 },
			[
				{ key: 'short', start: 0, end: 20, rail: -1 },
				{ key: 'long', start: 0, end: 30, rail: -1 },
				{ key: 'reused-short', start: 33, end: 45, rail: -1 },
				{ key: 'choice', start: 60, end: 70, rail: -1 },
			],
			0,
		);
		expect(allocation.trackCount).toBe(2);
		expect([...allocation.trackByRunKey.values()]).toEqual([0, 1, 0, 1]);
	});
	it('requires strictly more than twelve units of clearance before reusing a rail', () => {
		for (const [start, expected] of [
			[32, 1],
			[33, 0],
		] as const) {
			const allocation = allocateChannelIntervals(
				{ ownerId: '@root/channel/clearance', capacity: 2, spacing: 24 },
				[
					{ key: 'first', start: 0, end: 20, rail: -1 },
					{ key: 'second', start, end: start + 10, rail: -1 },
				],
				0,
			);
			expect(allocation.trackByRunKey.get('second')).toBe(expected);
		}
	});
	it('reuses within a channel edge capacity but rejects overlapping demand beyond it', () => {
		const edge = { ownerId: '@root/channel/bounded', capacity: 1, spacing: 24 };
		const first = { key: 'first', start: 0, end: 20, rail: -1 };
		expect(
			allocateChannelIntervals(edge, [first, { key: 'later', start: 33, end: 40, rail: -1 }], 0)
				.trackCount,
		).toBe(1);
		expect(() =>
			allocateChannelIntervals(edge, [first, { key: 'overlap', start: 32, end: 40, rail: -1 }], 0),
		).toThrow('Routing edge @root/channel/bounded has insufficient channel tracks.');
		expect(() =>
			allocateChannelIntervals(
				{ ...edge, capacity: 2 },
				[first, { key: 'overlap', start: 32, end: 40, rail: -1 }],
				1,
			),
		).toThrow('Routing edge @root/channel/bounded has insufficient channel tracks.');
	});
	it('keeps split occurrences distinct and shares a family traverse across relations', () => {
		const split = routeChannel([
			{ id: 'a', source: 48, target: 96 },
			{ id: 'b', source: 96, target: 48 },
		]);
		const a = split.wires.find(({ id }) => id === 'a');
		const b = split.wires.find(({ id }) => id === 'b');
		expect(split.wires.filter(({ middle }) => middle !== undefined)).toHaveLength(1);
		const divided = split.wires.find(({ middle }) => middle !== undefined);
		expect(divided?.first).not.toBe(divided?.last);
		expect(divided?.first?.depth).toBeLessThan(divided?.last?.depth ?? -1);
		expect(divided?.first?.key).not.toBe(divided?.last?.key);
		expect(split.trackByRunKey.get(divided?.first?.key ?? -1)).toBe(divided?.first?.rail);
		expect(split.trackByRunKey.get(divided?.last?.key ?? -1)).toBe(divided?.last?.rail);
		expect(a?.first).not.toBe(b?.first);
		const family = routeChannel([
			{ id: 'a', source: 0, target: 48, sharedSource: 'common' },
			{ id: 'b', source: 0, target: 96, sharedSource: 'common' },
		]);
		expect(family.wires[0]?.first).toBe(family.wires[1]?.first);
		expect(family.trackByRunKey.size).toBe(1);
		expect(family.wires[0]?.first?.start).toBe(0);
		expect(family.wires[0]?.first?.end).toBe(96);
	});
	it('breaks a column-constraint cycle while keeping direct wires straight', () => {
		const input = [
			{ id: 'left', source: 0, target: 0 },
			{ id: 'a', source: 48, target: 96 },
			{ id: 'b', source: 96, target: 48 },
			{ id: 'right', source: 144, target: 144 },
		];
		const snapshot = structuredClone(input);
		const result = routeChannel(input);
		expect(result.railCount).toBe(3);
		expect(result.wires.filter(({ middle }) => middle !== undefined)).toHaveLength(1);
		expect(result.wires.filter(({ first }) => first === undefined).map(({ id }) => id)).toEqual([
			'left',
			'right',
		]);
		expect(input).toEqual(snapshot);
		expect(routeChannel(input.toReversed()).wires).toEqual(result.wires.toReversed());
	});
	it('does not reserve a transverse rail for an empty or entirely straight channel', () => {
		expect(routeChannel([]).railCount).toBe(0);
		expect(routeChannel([{ id: 'direct', source: 0, target: 0 }]).railCount).toBe(0);
	});
});

it('shares an ordinary endpoint port without merging other ports or coincident foreign endpoints', () => {
	const relations = [
		{ id: 'one', from: 'ordinary-node', to: 'a' },
		{ id: 'two', from: 'ordinary-node', to: 'b' },
		{ id: 'other-port', from: 'ordinary-node', to: 'c' },
		{ id: 'foreign', from: 'other-node', to: 'd' },
	];
	const offsets = new Map([
		['one', -24],
		['two', -24],
		['other-port', 24],
		['foreign', -24],
	]);
	const shared = sharedSourcePorts(relations, offsets);
	expect([...shared.keys()]).toEqual(['one', 'two']);
	expect(shared.get('one')).toBe(shared.get('two'));
	expect(sharedSourcePorts(relations.toReversed(), offsets)).toEqual(shared);
	expect(sharedSourcePorts(relations.slice(0, 2), new Map()).size).toBe(2);
	const converging = relations.map((relation) => {
		let to = relation.to;
		if (['one', 'two'].includes(relation.id)) to = 'ordinary-target';
		return { ...relation, to };
	});
	const sharedTargets = sharedTargetPorts(converging, offsets);
	expect([...sharedTargets.keys()]).toEqual(['one', 'two']);
	expect(sharedTargets.get('one')).toBe(sharedTargets.get('two'));
});
