import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';
import { createGraph, type LogicGraph } from '../../src/lib/graph/create-graph';
import { topologicallyRank, type TopologicalRanks } from '../../src/lib/graph/topological-ranks';
import {
	type Bounds,
	layoutGraph,
	type LayoutResult,
	type Point,
} from '../../src/lib/layout/layout-graph';
import { fractionalOrderKeySpace } from '../../src/lib/layout/order-key-space';
import { layoutMeasurementsFor } from '../builders/layout-measurements';
import { validLogicDocument } from '../builders/logic-document';
import { openLiveDocument, openReferenceLiveDocument } from '../harnesses/open-live-document';
import { withReorderedTables } from '../perturbators/sequit-source';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

interface LayoutFixture {
	readonly document: LogicDocument;
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly layout: LayoutResult;
}

function requiredPoint(points: readonly Point[], index: number): Point {
	const point = points.at(index);
	if (point === undefined) throw new Error(`Missing routed point at ${index}`);
	return point;
}

async function layoutDocument(document: LogicDocument): Promise<LayoutFixture> {
	const graphResult = createGraph(document);
	if (!graphResult.ok) throw new Error('Expected an acyclic graph');
	const ranks = topologicallyRank(graphResult.value);
	const layout = await layoutGraph(graphResult.value, ranks, layoutMeasurementsFor(document));
	return { document, graph: graphResult.value, ranks, layout };
}

function boundsById(layout: LayoutResult): ReadonlyMap<string, Bounds> {
	return new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
}

function withOrder(document: LogicDocument, preferred: readonly string[]): LogicDocument {
	const ids = [...document.groups, ...document.nodes, ...document.junctions].map(({ id }) => id);
	const order = [...preferred, ...ids.filter((id) => !preferred.includes(id)).sort()];
	const key = new Map(order.map((id, index) => [id, orderKey(`a${index.toString(36)}`)]));
	const keyFor = (id: string) => {
		const result = key.get(id);
		if (result === undefined) throw new Error(`Missing order key for endpoint: ${id}`);
		return result;
	};
	return {
		...document,
		groups: document.groups.map((endpoint) => ({
			...endpoint,
			layoutOrder: keyFor(endpoint.id),
		})),
		nodes: document.nodes.map((endpoint) => ({ ...endpoint, layoutOrder: keyFor(endpoint.id) })),
		junctions: document.junctions.map((endpoint) => ({
			...endpoint,
			layoutOrder: keyFor(endpoint.id),
		})),
	};
}

function overlaps(left: Bounds, right: Bounds): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
}

function isOnBoundary(point: Point, bounds: Bounds): boolean {
	const withinX = point.x >= bounds.x && point.x <= bounds.x + bounds.width;
	const withinY = point.y >= bounds.y && point.y <= bounds.y + bounds.height;
	const onVertical = point.x === bounds.x || point.x === bounds.x + bounds.width;
	const onHorizontal = point.y === bounds.y || point.y === bounds.y + bounds.height;
	return (withinY && onVertical) || (withinX && onHorizontal);
}

describe('layoutGraph', () => {
	it('preserves the asynchronous engine boundary', async () => {
		const document = await openReferenceLiveDocument();
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected an acyclic graph');
		const pending = layoutGraph(
			graph.value,
			topologicallyRank(graph.value),
			layoutMeasurementsFor(document),
		);

		expect(pending).toBeInstanceOf(Promise);
		await pending;
	});

	it('rejects incomplete and invalid measurements through the asynchronous boundary', async () => {
		const document = validLogicDocument();
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected an acyclic graph');
		const ranks = topologicallyRank(graph.value);
		const missingMeasurements = layoutMeasurementsFor(document);
		const missing = {
			...missingMeasurements,
			nodes: new Map(missingMeasurements.nodes),
		};
		missing.nodes.delete('source-a');

		await expect(layoutGraph(graph.value, ranks, missing)).rejects.toThrow(
			'Missing node measurement: source-a',
		);

		const invalidMeasurements = layoutMeasurementsFor(document);
		const invalid = {
			...invalidMeasurements,
			nodes: new Map(invalidMeasurements.nodes),
		};
		invalid.nodes.set('source-a', { width: 0, height: 40 });
		await expect(layoutGraph(graph.value, ranks, invalid)).rejects.toThrow(
			'nodes.source-a.width must be a finite positive number',
		);
	});

	it('produces a finite empty stage for an empty semantic document', async () => {
		const valid = validLogicDocument();
		const document: LogicDocument = {
			...valid,
			natures: [],
			groups: [],
			nodes: [],
			junctions: [],
			relations: [],
		};
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected an empty graph');

		await expect(
			layoutGraph(graph.value, topologicallyRank(graph.value), layoutMeasurementsFor(document)),
		).resolves.toEqual({ width: 80, height: 80, elements: [], relations: [] });
	});

	it('places every dependency bottom-to-top without overlapping endpoints', async () => {
		const { graph, ranks, layout } = await layoutDocument(await openReferenceLiveDocument());
		const byId = boundsById(layout);
		for (const { source, target } of graph.relations) {
			const sourceBounds = byId.get(source.entity.id);
			const targetBounds = byId.get(target.entity.id);
			if (!sourceBounds || !targetBounds) throw new Error('Expected relation endpoint bounds');
			expect(targetBounds.y + targetBounds.height).toBeLessThan(sourceBounds.y);
		}

		const rankedIds = [...ranks.byEndpointId.keys()];
		for (let leftIndex = 0; leftIndex < rankedIds.length; leftIndex += 1) {
			for (let rightIndex = leftIndex + 1; rightIndex < rankedIds.length; rightIndex += 1) {
				const left = byId.get(rankedIds[leftIndex] ?? '');
				const right = byId.get(rankedIds[rightIndex] ?? '');
				if (left && right) expect(overlaps(left, right)).toBe(false);
			}
		}
		expect(ranks.bands.some((ids) => ids.length > 1)).toBe(true);
	});

	it('contains group members and gives the empty endpoint group explicit bounds', async () => {
		const { document, layout } = await layoutDocument(await openReferenceLiveDocument());
		const byId = boundsById(layout);
		const useCases = byId.get('use-cases');
		const dataTeam = byId.get('data-team');
		expect(useCases).toBeDefined();
		expect(dataTeam).toMatchObject({ width: 160, height: 72 });
		if (!useCases) throw new Error('Expected use-cases bounds');

		const memberIds = [
			...document.nodes.filter(({ groupId }) => groupId === 'use-cases').map(({ id }) => id),
			...document.junctions.filter(({ groupId }) => groupId === 'use-cases').map(({ id }) => id),
		];
		for (const id of memberIds) {
			const member = byId.get(id);
			expect(member, id).toBeDefined();
			if (!member) continue;
			expect(member.x).toBeGreaterThan(useCases.x);
			expect(member.y).toBeGreaterThan(useCases.y);
			expect(member.x + member.width).toBeLessThan(useCases.x + useCases.width);
			expect(member.y + member.height).toBeLessThan(useCases.y + useCases.height);
		}
	});

	it('gives bounds to an empty unranked group without adding a topological rank', async () => {
		const document = validLogicDocument();
		const { ranks, layout } = await layoutDocument(document);
		const orphan = boundsById(layout).get('orphan-group');

		expect(ranks.byEndpointId.has('orphan-group')).toBe(false);
		expect(orphan).toMatchObject({
			width: 160,
			height: 72,
		});
		expect(Number.isFinite(orphan?.x)).toBe(true);
		expect(Number.isFinite(orphan?.y)).toBe(true);
	});

	it('preserves explicit variable measurements in the result', async () => {
		const document = validLogicDocument();
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected an acyclic graph');
		const originalMeasurements = layoutMeasurementsFor(document);
		const measurements = {
			...originalMeasurements,
			nodes: new Map(originalMeasurements.nodes),
		};
		measurements.nodes.set('source-a', { width: 180, height: 40 });
		measurements.nodes.set('source-b', { width: 240, height: 130 });

		const layout = await layoutGraph(graph.value, topologicallyRank(graph.value), measurements);
		const bounds = boundsById(layout);
		const sourceA = bounds.get('source-a');
		const sourceB = bounds.get('source-b');
		expect(sourceA).toMatchObject({ width: 180, height: 40 });
		expect(sourceB).toMatchObject({ width: 240, height: 130 });
		if (!sourceA || !sourceB) throw new Error('Expected source bounds');
		expect(overlaps(sourceA, sourceB)).toBe(false);
	});

	it('routes every relation from and to its endpoint bounds', async () => {
		const { layout } = await layoutDocument(await openReferenceLiveDocument());
		const byId = boundsById(layout);

		for (const relation of layout.relations) {
			const source = byId.get(relation.from);
			const target = byId.get(relation.to);
			expect(source).toBeDefined();
			expect(target).toBeDefined();
			if (!source || !target) continue;
			expect(isOnBoundary(requiredPoint(relation.points, 0), source), `${relation.id} source`).toBe(
				true,
			);
			expect(
				isOnBoundary(requiredPoint(relation.points, -1), target),
				`${relation.id} target`,
			).toBe(true);
		}
		const dataTeamRelation = layout.relations.find(
			({ id }) => id === 'data-team-to-ai-content-generation',
		);
		const dataTeam = byId.get('data-team');
		expect(dataTeamRelation && requiredPoint(dataTeamRelation.points, 0).y).toBe(dataTeam?.y);
	});

	it('rejects overlapping relation endpoint bounds before routing with the relation identity', async () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			relations: [
				...base.relations,
				{ id: 'containing-group-to-member', from: 'container', to: 'source-a' },
			],
		};
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected an acyclic graph');

		await expect(
			layoutGraph(graph.value, topologicallyRank(graph.value), layoutMeasurementsFor(document)),
		).rejects.toThrow(
			'Relation bounds overlap: containing-group-to-member (container -> source-a)',
		);
	});

	it('uses explicit endpoint order within a component without changing ranks', async () => {
		const original = validLogicDocument();
		const document = withOrder(original, ['source-b', 'source-a']);
		const { ranks, layout } = await layoutDocument(document);
		const bounds = boundsById(layout);

		expect(ranks.byEndpointId.get('source-a')).toBe(ranks.byEndpointId.get('source-b'));
		expect(bounds.get('source-b')?.x).toBeLessThan(bounds.get('source-a')?.x ?? 0);
		expect(bounds.get('choice')?.y).not.toBe(bounds.get('source-a')?.y);
	});

	it('uses effective endpoint order for independent components in the same context', async () => {
		const original = validLogicDocument();
		const document = withOrder(
			{
				...original,
				groups: [],
				nodes: [
					{
						kind: EndpointKind.Node,
						id: 'aa-added-second',
						natureId: 'goal',
						markdown: 'Added second',
						layoutOrder: orderKey('a0'),
					},
					{
						kind: EndpointKind.Node,
						id: 'zz-added-first',
						natureId: 'goal',
						markdown: 'Added first',
						layoutOrder: orderKey('a1'),
					},
				],
				junctions: [],
				relations: [],
			},
			['zz-added-first', 'aa-added-second'],
		);
		const bounds = boundsById((await layoutDocument(document)).layout);

		expect(bounds.get('zz-added-first')?.x).toBeLessThan(bounds.get('aa-added-second')?.x ?? 0);
	});

	it('keeps disconnected component packing stable after a target-local key move', async () => {
		const peerKey = orderKey('a1');
		const movedKey = fractionalOrderKeySpace.keyFor({ after: peerKey }, 'moving-target');
		const isolatedKey = fractionalOrderKeySpace.keyFor(
			{ before: movedKey, after: peerKey },
			'isolated',
		);
		const before: LogicDocument = {
			persistenceFormat: 2,
			id: 'component-local-order-change',
			title: 'Component-local order change',
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
			groups: [],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'component-source',
					natureId: 'goal',
					markdown: 'Source',
					layoutOrder: orderKey('a3'),
				},
				{
					kind: EndpointKind.Node,
					id: 'component-peer',
					natureId: 'goal',
					markdown: 'Peer',
					layoutOrder: peerKey,
				},
				{
					kind: EndpointKind.Node,
					id: 'moving-target',
					natureId: 'goal',
					markdown: 'Moving target',
					layoutOrder: orderKey('a2'),
				},
				{
					kind: EndpointKind.Node,
					id: 'isolated',
					natureId: 'goal',
					markdown: 'Isolated',
					layoutOrder: isolatedKey,
				},
			],
			junctions: [],
			relations: [
				{ id: 'source-to-peer', from: 'component-source', to: 'component-peer' },
				{ id: 'source-to-target', from: 'component-source', to: 'moving-target' },
			],
		};
		const after: LogicDocument = {
			...before,
			nodes: before.nodes.map((node) =>
				node.id === 'moving-target' ? { ...node, layoutOrder: movedKey } : node,
			),
		};
		const beforeBounds = boundsById((await layoutDocument(before)).layout);
		const afterBounds = boundsById((await layoutDocument(after)).layout);

		expect(beforeBounds.get('isolated')?.x).toBeLessThan(
			beforeBounds.get('component-source')?.x ?? 0,
		);
		expect(afterBounds.get('isolated')?.x).toBeLessThan(
			afterBounds.get('component-source')?.x ?? 0,
		);
	});

	it('filters stable global order after topology-driven rank migration', async () => {
		const base: LogicDocument = {
			persistenceFormat: 2,
			id: 'rank-migration',
			title: 'Rank migration',
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
			groups: [],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'source',
					natureId: 'goal',
					markdown: 'Source',
					layoutOrder: orderKey('a0'),
				},
				{
					kind: EndpointKind.Node,
					id: 'middle',
					natureId: 'goal',
					markdown: 'Middle',
					layoutOrder: orderKey('a1'),
				},
				{
					kind: EndpointKind.Node,
					id: 'migrating',
					natureId: 'goal',
					markdown: 'Migrating',
					layoutOrder: orderKey('a2'),
				},
				{
					kind: EndpointKind.Node,
					id: 'existing',
					natureId: 'goal',
					markdown: 'Existing',
					layoutOrder: orderKey('a3'),
				},
			],
			junctions: [],
			relations: [
				{ id: 'source-to-middle', from: 'source', to: 'middle' },
				{ id: 'middle-to-existing', from: 'middle', to: 'existing' },
			],
		};
		const migrated: LogicDocument = {
			...base,
			relations: [
				...base.relations,
				{ id: 'middle-to-migrating', from: 'middle', to: 'migrating' },
			],
		};
		const { ranks, layout } = await layoutDocument(migrated);
		const bounds = boundsById(layout);

		expect(ranks.byEndpointId.get('migrating')).toBe(2);
		expect(ranks.byEndpointId.get('existing')).toBe(2);
		expect(bounds.get('migrating')?.x).toBeLessThan(bounds.get('existing')?.x ?? 0);
	});

	it('retains ordering and geometry invariants with groups, junctions, and a long link', async () => {
		const document: LogicDocument = withOrder(
			{
				persistenceFormat: 2,
				id: 'ordered-topology-edge-cases',
				title: 'Ordered topology edge cases',
				layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
				natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
				groups: [
					{
						kind: EndpointKind.Group,
						id: 'container',
						label: 'Container',
						layoutOrder: orderKey('a0'),
					},
					{
						kind: EndpointKind.Group,
						id: 'empty-endpoint',
						label: 'Empty endpoint',
						layoutOrder: orderKey('a1'),
					},
				],
				nodes: [
					{
						kind: EndpointKind.Node,
						id: 'source-a',
						natureId: 'goal',
						groupId: 'container',
						markdown: 'Source A',
						layoutOrder: orderKey('a2'),
					},
					{
						kind: EndpointKind.Node,
						id: 'source-b',
						natureId: 'goal',
						groupId: 'container',
						markdown: 'Source B',
						layoutOrder: orderKey('a3'),
					},
					{
						kind: EndpointKind.Node,
						id: 'target-a',
						natureId: 'goal',
						groupId: 'container',
						markdown: 'Target A',
						layoutOrder: orderKey('a4'),
					},
					{
						kind: EndpointKind.Node,
						id: 'target-b',
						natureId: 'goal',
						groupId: 'container',
						markdown: 'Target B',
						layoutOrder: orderKey('a5'),
					},
					{
						kind: EndpointKind.Node,
						id: 'long-target',
						natureId: 'goal',
						groupId: 'container',
						markdown: 'Long target',
						layoutOrder: orderKey('a6'),
					},
				],
				junctions: [
					{
						kind: EndpointKind.Junction,
						id: 'choice',
						operator: JunctionOperator.Xor,
						groupId: 'container',
						layoutOrder: orderKey('a7'),
					},
				],
				relations: [
					{ id: 'source-a-to-choice', from: 'source-a', to: 'choice' },
					{ id: 'choice-to-target-a', from: 'choice', to: 'target-a' },
					{ id: 'source-b-to-target-b', from: 'source-b', to: 'target-b' },
					{ id: 'empty-to-target-b', from: 'empty-endpoint', to: 'target-b' },
					{ id: 'target-a-to-long-target', from: 'target-a', to: 'long-target' },
					{ id: 'source-b-to-long-target', from: 'source-b', to: 'long-target' },
				],
			},
			['source-b', 'source-a', 'empty-endpoint', 'choice', 'target-b', 'target-a', 'long-target'],
		);
		const first = await layoutDocument(document);
		const reordered = await layoutDocument({
			...document,
			groups: [...document.groups].reverse(),
			nodes: [...document.nodes].reverse(),
			junctions: [...document.junctions].reverse(),
			relations: [...document.relations].reverse(),
		});
		const bounds = boundsById(first.layout);
		const container = bounds.get('container');
		if (!container) throw new Error('Expected populated group bounds');

		expect(bounds.get('source-b')?.x).toBeLessThan(bounds.get('source-a')?.x ?? 0);
		expect(bounds.get('target-b')?.x).toBeLessThan(bounds.get('target-a')?.x ?? 0);
		expect(bounds.get('choice')?.y).not.toBe(bounds.get('source-a')?.y);
		expect(bounds.get('empty-endpoint')).toMatchObject({ width: 160, height: 72 });
		for (const id of ['source-a', 'source-b', 'choice', 'target-a', 'target-b', 'long-target']) {
			const member = bounds.get(id);
			if (!member) throw new Error(`Expected bounds for ${id}`);
			expect(overlaps(member, container)).toBe(true);
		}
		for (const relation of first.layout.relations) {
			const source = bounds.get(relation.from);
			const target = bounds.get(relation.to);
			if (!source || !target) throw new Error(`Expected relation bounds for ${relation.id}`);
			expect(isOnBoundary(requiredPoint(relation.points, 0), source)).toBe(true);
			expect(isOnBoundary(requiredPoint(relation.points, -1), target)).toBe(true);
		}
		expect(reordered.layout).toEqual(first.layout);
	});

	it('keeps explicit order deterministic when semantic collections are reordered', async () => {
		const original = validLogicDocument();
		const document = withOrder(original, ['source-b', 'source-a']);
		const reordered: LogicDocument = {
			...document,
			natures: [...document.natures].reverse(),
			groups: [...document.groups].reverse(),
			nodes: [...document.nodes].reverse(),
			junctions: [...document.junctions].reverse(),
			relations: [...document.relations].reverse(),
		};

		expect((await layoutDocument(reordered)).layout).toEqual(
			(await layoutDocument(document)).layout,
		);
	});

	it('is deterministic for identical inputs and reordered TOML tables', async () => {
		const source = await aiDocumentaryEffortScenario();
		const document = openLiveDocument(source);
		const first = await layoutDocument(document);
		const second = await layoutDocument(document);
		const reordered = await layoutDocument(openLiveDocument(withReorderedTables(source)));

		expect(second.layout).toEqual(first.layout);
		expect(reordered.layout).toEqual(first.layout);
	});
});
