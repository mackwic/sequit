import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { WideBipartiteLayersScenarioBuilder } from '../../../../src/app/workshop/fixtures/layout-performance/builders/wide-bipartite-layers-scenario';
import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { buildLayoutResult } from '../../../../src/lib/core/layout/build-layout-result';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import {
	layoutWithDedicatedEngine,
	layoutWithDedicatedEngineForProjection,
} from '../../../../src/lib/core/layout/layout-engine';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import { ChannelRoutingCache } from '../../../../src/lib/core/layout/routing/channel-routing-cache';
import { applyNodeRouting } from '../../../../src/lib/core/layout/routing/materialize-node-routes';
import { allocatePorts } from '../../../../src/lib/core/layout/routing/port-allocation';
import { planNodeRouting } from '../../../../src/lib/core/layout/routing/reserve-node-routing';
import {
	corridorCarriesCanonicalIndexes,
	crossingCorridors,
} from '../../../../src/lib/core/layout/routing/routing-corridors';
import { routingSpace } from '../../../../src/lib/core/layout/routing/routing-space';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

function crossingFixture(vertical: boolean) {
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
	const created = createGraph(document);
	if (!created.ok) throw new Error('Expected a valid crossing fixture');
	const graph = created.value;
	const ranks = new Map<string, number>([
		['source-a', 1],
		['source-b', 1],
		['target', 0],
		['isolated', 0],
	]);
	const transverse = new Map([
		['source-a', 0],
		['source-b', 100],
		['target', 100],
		['isolated', 0],
	]);
	const bounds = new Map<string, Bounds>();
	for (const [id, cross] of transverse) {
		let main = 0;
		if (ranks.get(id) === 1) main = 120;
		let box = { x: cross, y: main, width: 80, height: 60 };
		if (!vertical) box = { x: box.y, y: cross, width: 60, height: 80 };
		bounds.set(id, box);
	}
	const sizes = new Map(
		[...bounds].map(([id, { width, height }]) => [id, { width, height }] as const),
	);
	let direction = LayoutDirection.LeftToRight;
	if (vertical) direction = LayoutDirection.TopToBottom;
	const frame = createLayoutFrame(direction, LayoutBias.Top);
	const corridors = crossingCorridors({ graph, ranks, bounds, vertical });
	const ports = allocatePorts({
		graph,
		bounds,
		sizes,
		vertical,
		corridors,
		fromCrossingCorridors: true,
	});
	const routing = planNodeRouting({ corridors, ports, bounds, vertical, ranks });
	const layers = {
		rows: [
			['target', 'isolated'],
			['source-a', 'source-b'],
		],
		intervals: [0, 1],
		byId: new Map([
			['source-a', 1],
			['source-b', 1],
			['target', 0],
			['isolated', 0],
		]),
	};
	const space = routingSpace({ layers, bounds, frame, enclosingGroups: new Set() });
	return { graph, bounds, frame, routing, space, corridors };
}

function digest(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('indexed channel route materialization', () => {
	it('preserves every route and complete layout with a direct corridor fallback', () => {
		for (const vertical of [true, false]) {
			const fixture = crossingFixture(vertical);
			const { graph, bounds, frame, routing, space } = fixture;
			expect(routing.corridors.length).toBeGreaterThan(0);
			expect(
				routing.corridors.every(({ corridor }) => corridorCarriesCanonicalIndexes(corridor, graph)),
			).toBe(true);
			const indexed = applyNodeRouting({
				plan: routing,
				bounds,
				direction: frame.direction,
				relationCount: graph.relations.length,
				frames: [],
			});
			const directRouting = {
				...routing,
				corridors: routing.corridors.map((channel) => ({
					...channel,
					corridor: { ...channel.corridor },
				})),
			};
			expect(
				directRouting.corridors.every(({ corridor }) =>
					corridorCarriesCanonicalIndexes(corridor, graph),
				),
			).toBe(false);
			const fallback = applyNodeRouting({
				plan: directRouting,
				bounds,
				direction: frame.direction,
				relationCount: undefined,
				frames: [],
			});
			for (const [index, { relation }] of graph.relations.entries())
				expect(indexed.byIndex?.[index]).toEqual(fallback.byId?.get(relation.id));
			const common = { graph, bounds, frame, space };
			expect(buildLayoutResult({ ...common, routing })).toEqual(
				buildLayoutResult({ ...common, routing: directRouting }),
			);
			expect(buildLayoutResult({ ...common, routing })).toEqual(
				buildLayoutResult({ ...common, graph: { ...graph }, routing }),
			);
		}
	});

	it('certifies graph relations in any order, but not repeated ones', () => {
		const { graph, bounds } = crossingFixture(true);
		const ranks = new Map<string, number>([
			['source-a', 1],
			['source-b', 1],
			['target', 0],
			['isolated', 0],
		]);
		const first = graph.relations[0];
		if (first === undefined) throw new Error('Expected a fixture relation');
		for (const [relations, certified] of [
			[graph.relations.toReversed(), true],
			[[first, ...graph.relations], false],
		] as const) {
			const directGraph = { ...graph, relations };
			const corridors = crossingCorridors({ graph: directGraph, ranks, bounds, vertical: true });
			expect(corridors.length).toBeGreaterThan(0);
			expect(
				corridors.every((corridor) => corridorCarriesCanonicalIndexes(corridor, directGraph)),
			).toBe(certified);
		}
	});

	it('uses direct routes when an explicit routing plan has no corridor', () => {
		const { graph, bounds, frame, routing, space } = crossingFixture(true);
		const emptyRouting = {
			...routing,
			corridors: [],
			ports: {
				...routing.ports,
				sourceOffsets: new Map<string, number>(),
				targetOffsets: new Map<string, number>(),
			},
		};
		const common = { graph, bounds, frame, space };
		const direct = buildLayoutResult({ ...common, routing: emptyRouting });
		expect(direct).toEqual(buildLayoutResult({ ...common, routing: undefined }));
		expect(direct.relations.map(({ id }) => id)).toEqual(
			graph.relations.map(({ relation }) => relation.id).toSorted(compareCanonicalStrings),
		);
		const reorderedGraph = { ...graph, relations: graph.relations.toReversed() };
		expect(buildLayoutResult({ ...common, graph: reorderedGraph, routing: emptyRouting })).toEqual(
			direct,
		);
		expect(direct.relations.find(({ id }) => id === 'source-a-target')?.points).toEqual([
			{ x: 40, y: 120 },
			{ x: 40, y: 90 },
			{ x: 140, y: 90 },
			{ x: 140, y: 60 },
		]);
	});

	it('updates cached public relation order across projection edits', () => {
		const { graph } = crossingFixture(true);
		const channels = new ChannelRoutingCache();
		const initial = prepareLayoutDocument(graph.document);
		const first = layoutWithDedicatedEngineForProjection(
			initial.graph,
			initial.ranks,
			initial.measurements,
			{ channels },
		);
		expect(first.relations.map(({ id }) => id)).toEqual(
			graph.document.relations.map(({ id }) => id).toSorted(compareCanonicalStrings),
		);

		const addedRelations = [
			{ id: 'a-added-parallel', from: 'source-a', to: 'target' },
			{ id: 'source-b-new', from: 'source-b', to: 'target' },
		];
		const addedDocument = {
			...graph.document,
			relations: [...graph.document.relations, ...addedRelations],
		};
		const added = prepareLayoutDocument(addedDocument);
		const incrementalAdd = layoutWithDedicatedEngineForProjection(
			added.graph,
			added.ranks,
			added.measurements,
			{ channels },
		);
		expect(incrementalAdd).toEqual(
			layoutWithDedicatedEngine(added.graph, added.ranks, added.measurements),
		);
		expect(incrementalAdd.relations.map(({ id }) => id)).toEqual(
			addedDocument.relations.map(({ id }) => id).toSorted(compareCanonicalStrings),
		);

		const removedDocument = {
			...addedDocument,
			relations: addedDocument.relations.filter(({ id }) => id !== 'source-b-isolated'),
		};
		const removed = prepareLayoutDocument(removedDocument);
		const incrementalRemove = layoutWithDedicatedEngineForProjection(
			removed.graph,
			removed.ranks,
			removed.measurements,
			{ channels },
		);
		expect(incrementalRemove).toEqual(
			layoutWithDedicatedEngine(removed.graph, removed.ranks, removed.measurements),
		);
		expect(incrementalRemove.relations.map(({ id }) => id)).toEqual(
			removedDocument.relations.map(({ id }) => id).toSorted(compareCanonicalStrings),
		);
	});

	it('preserves the full dense adjacent-rank result', () => {
		const { document } = new WideBipartiteLayersScenarioBuilder().buildSnapshot(1000);
		const prepared = prepareLayoutDocument(document);
		const result = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.elements).toHaveLength(1000);
		expect(result.relations).toHaveLength(40169);
		// Re-pinned for channel block exchanges: same boxes and relations, rails reassigned where
		// that removes crossings (the 100-node snapshot of this topology goes from 68378 to 68064).
		expect(digest(result)).toBe('512ea3da4e742f275dc435b533c838cf70db1b0badb28a4007ab09de39e8df10');
	});
});
