import { describe, expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import { RoutingPortRole } from '../../../../src/lib/core/layout/layout-types';
import { centerRelatedRows } from '../../../../src/lib/core/layout/placement/center-related-rows';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import {
	allocatePorts,
	PortMetricDemandKind,
	sharedSourcePorts,
	sharedTargetPorts,
} from '../../../../src/lib/core/layout/routing/port-allocation';
import { packRails } from '../../../../src/lib/core/layout/routing/rail-packing';
import { crossingCorridors } from '../../../../src/lib/core/layout/routing/routing-corridors';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { layoutDocument } from '../../../support/harnesses/layout';

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
		const runs = [
			{ start: 0, end: 100, rail: -1 },
			{ start: 0, end: 20, rail: -1 },
			{ start: 33, end: 50, rail: -1 },
		];
		expect(packRails(runs, 2)).toBe(2);
		expect(runs.map(({ rail }) => rail)).toEqual([3, 2, 2]);
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
	it('tolerates absent parent metadata and an empty component without invented alignment', () => {
		const bounds = new Map<string, Bounds>([
			['a', { x: 0, y: 0, width: 60, height: 20 }],
			['b', { x: 0, y: 100, width: 60, height: 20 }],
			['c', { x: 96, y: 100, width: 60, height: 20 }],
		]);
		for (const parents of [new Map<string, string[]>(), new Map([['b', ['a']]])]) {
			const original = structuredClone(bounds);
			centerRelatedRows({ rows: [['a'], ['b', 'c']], bounds, parents, vertical: true });
			expect(bounds).toEqual(original);
		}
		expect(
			centerRelatedRows({ rows: [[]], bounds: new Map(), parents: new Map(), vertical: true }),
		).toBe(1);
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
