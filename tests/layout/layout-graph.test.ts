import { describe, expect, it } from 'vitest';

import type { LogicDocument } from '../../src/lib/document/logic-document';
import { createGraph } from '../../src/lib/graph/create-graph';
import { topologicallyRank } from '../../src/lib/graph/topological-ranks';
import { type Bounds, layoutGraph, type Point } from '../../src/lib/layout/layout-graph';
import { layoutMeasurementsFor } from '../builders/layout-measurements';
import { validLogicDocument } from '../builders/logic-document';
import { boundsById, layoutDocument, overlaps, prepareLayoutDocument } from '../harnesses/layout';
import { openLiveDocument, openReferenceLiveDocument } from '../harnesses/open-live-document';
import { withReorderedTables } from '../perturbators/sequit-source';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

function isOnBoundary(point: Point, bounds: Bounds): boolean {
	const withinX = point.x >= bounds.x && point.x <= bounds.x + bounds.width;
	const withinY = point.y >= bounds.y && point.y <= bounds.y + bounds.height;
	const onVertical = point.x === bounds.x || point.x === bounds.x + bounds.width;
	const onHorizontal = point.y === bounds.y || point.y === bounds.y + bounds.height;
	return (withinY && onVertical) || (withinX && onHorizontal);
}

describe('layoutGraph', () => {
	it('prepares graph, ranks, and measurements without completing layout', async () => {
		const document = validLogicDocument();
		const prepared = prepareLayoutDocument(document, {
			nodes: { 'source-a': { width: 0, height: 40 } },
		});

		expect(prepared.document).toBe(document);
		expect(prepared.graph.document).toBe(document);
		expect(prepared.ranks.byEndpointId.get('source-a')).toBe(0);
		expect(prepared.measurements.nodes.get('source-a')).toEqual({ width: 0, height: 40 });
		expect(prepared).not.toHaveProperty('layout');

		await expect(
			layoutGraph(prepared.graph, prepared.ranks, prepared.measurements),
		).rejects.toThrow('nodes.source-a.width must be a finite positive number');
	});

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
			expect(isOnBoundary(relation.points[0], source), `${relation.id} source`).toBe(true);
			expect(
				isOnBoundary(relation.points[relation.points.length - 1], target),
				`${relation.id} target`,
			).toBe(true);
		}
		const dataTeamRelation = layout.relations.find(
			({ id }) => id === 'data-team-to-ai-content-generation',
		);
		const dataTeam = byId.get('data-team');
		expect(dataTeamRelation?.points[0].y).toBe(dataTeam?.y);
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
