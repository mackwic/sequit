import { describe, expect, it } from 'vitest';

import type { LogicDocument } from '../../src/lib/document/logic-document';
import { createGraph, type LogicGraph } from '../../src/lib/graph/create-graph';
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

	it('lets a non-empty endpoint group span every rank occupied by its content', async () => {
		const valid = validLogicDocument();
		const document: LogicDocument = {
			...valid,
			nodes: [
				...valid.nodes.map((node) =>
					node.id === 'target' ? { ...node, groupId: 'container' } : node,
				),
				{ id: 'after-group', natureId: 'goal', markdown: 'After group\n' },
			],
			relations: [
				...valid.relations,
				{ id: 'isolated-to-container', from: 'isolated', to: 'container' },
				{ id: 'container-to-after', from: 'container', to: 'after-group' },
			],
		};
		const { ranks, layout } = await layoutDocument(document);
		const byId = boundsById(layout);
		const group = byId.get('container');
		const before = byId.get('isolated');
		const after = byId.get('after-group');
		if (!group || !before || !after) throw new Error('Expected group relation bounds');
		const memberIds = ['source-a', 'source-b', 'choice', 'target'];
		const memberRanks = new Set(memberIds.map((id) => ranks.byEndpointId.get(id)));

		expect(ranks.byEndpointId.has('container')).toBe(false);
		expect(memberRanks).toEqual(new Set([1, 2]));
		for (const memberId of memberIds) {
			const member = byId.get(memberId);
			if (!member) throw new Error(`Expected member bounds: ${memberId}`);
			expect(member.x).toBeGreaterThan(group.x);
			expect(member.y).toBeGreaterThan(group.y);
			expect(member.x + member.width).toBeLessThan(group.x + group.width);
			expect(member.y + member.height).toBeLessThan(group.y + group.height);
		}
		expect(group.y + group.height).toBeLessThan(before.y);
		expect(after.y + after.height).toBeLessThan(group.y);

		const incoming = layout.relations.find(({ id }) => id === 'isolated-to-container');
		const outgoing = layout.relations.find(({ id }) => id === 'container-to-after');
		if (!incoming || !outgoing) throw new Error('Expected group relations');
		expect(isOnBoundary(incoming.points[0] ?? { x: NaN, y: NaN }, before)).toBe(true);
		expect(
			isOnBoundary(incoming.points[incoming.points.length - 1] ?? { x: NaN, y: NaN }, group),
		).toBe(true);
		expect(isOnBoundary(outgoing.points[0] ?? { x: NaN, y: NaN }, group)).toBe(true);
		expect(
			isOnBoundary(outgoing.points[outgoing.points.length - 1] ?? { x: NaN, y: NaN }, after),
		).toBe(true);
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
			const start = relation.points.at(0);
			const end = relation.points.at(-1);
			expect(start).toBeDefined();
			expect(end).toBeDefined();
			if (!source || !target || !start || !end) continue;
			expect(isOnBoundary(start, source), `${relation.id} source`).toBe(true);
			expect(isOnBoundary(end, target), `${relation.id} target`).toBe(true);
		}
		const dataTeamRelation = layout.relations.find(
			({ id }) => id === 'data-team-to-ai-content-generation',
		);
		const dataTeam = byId.get('data-team');
		expect(dataTeamRelation?.points.at(0)?.y).toBe(dataTeam?.y);
	});

	it('places a logical junction between globally aligned node ranks', async () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			nodes: [
				...base.nodes,
				{ id: 'side-source', natureId: 'goal', markdown: 'Side source\n' },
				{ id: 'side-target', natureId: 'goal', markdown: 'Side target\n' },
			],
			relations: [
				...base.relations,
				{ id: 'side-source-to-target', from: 'side-source', to: 'side-target' },
			],
		};
		const { layout } = await layoutDocument(document);
		const bounds = boundsById(layout);
		const junction = bounds.get('choice');
		const sourceIds = ['source-a', 'source-b', 'side-source'];
		const targetIds = ['target', 'side-target'];
		const sources = sourceIds.map((id) => bounds.get(id));
		const targets = targetIds.map((id) => bounds.get(id));
		if (
			!junction ||
			sources.some((source) => source === undefined) ||
			targets.some((target) => target === undefined)
		) {
			throw new Error('Expected junction scenario bounds');
		}
		const sourceLineTop = sources[0]?.y ?? NaN;
		const targetLineTop = targets[0]?.y ?? NaN;
		const targetLineBottom = Math.max(
			...targets.map((target) => (target?.y ?? NaN) + (target?.height ?? NaN)),
		);

		expect(sources.map((source) => source?.y)).toEqual(sourceIds.map(() => sourceLineTop));
		expect(targets.map((target) => target?.y)).toEqual(targetIds.map(() => targetLineTop));
		expect(junction.y).toBeGreaterThan(targetLineBottom);
		expect(junction.y + junction.height).toBeLessThan(sourceLineTop);
		expect(junction.y + junction.height / 2).toBe((targetLineBottom + sourceLineTop) / 2);
	});

	it('rejects every incomplete endpoint and group measurement', async () => {
		const document = validLogicDocument();
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected an acyclic graph');
		const ranks = topologicallyRank(graph.value);
		const complete = layoutMeasurementsFor(document);

		const withoutJunction = { ...complete, junctions: new Map(complete.junctions) };
		withoutJunction.junctions.delete('choice');
		await expect(layoutGraph(graph.value, ranks, withoutJunction)).rejects.toThrow(
			'Missing junction measurement: choice',
		);

		const withoutEndpointGroup = { ...complete, groups: new Map(complete.groups) };
		withoutEndpointGroup.groups.delete('endpoint-group');
		await expect(layoutGraph(graph.value, ranks, withoutEndpointGroup)).rejects.toThrow(
			'Missing group measurement: endpoint-group',
		);

		const withoutStructuralGroup = { ...complete, groups: new Map(complete.groups) };
		withoutStructuralGroup.groups.delete('orphan-group');
		await expect(layoutGraph(graph.value, ranks, withoutStructuralGroup)).rejects.toThrow(
			'Missing group measurement: orphan-group',
		);
	});

	it('rejects every invalid measurement dimension', async () => {
		const document = validLogicDocument();
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected an acyclic graph');
		const ranks = topologicallyRank(graph.value);
		const complete = layoutMeasurementsFor(document);

		for (const [name, size, message] of [
			['not-finite', { width: Number.NaN, height: 40 }, 'nodes.source-a.width'],
			['invalid-height', { width: 80, height: 0 }, 'nodes.source-a.height'],
		] as const) {
			const measurements = { ...complete, nodes: new Map(complete.nodes) };
			measurements.nodes.set('source-a', size);
			await expect(layoutGraph(graph.value, ranks, measurements), name).rejects.toThrow(message);
		}

		for (const [field, value] of [
			['minimumWidth', 0],
			['minimumHeight', 0],
			['headerHeight', -1],
			['padding', Number.NaN],
		] as const) {
			const measurements = { ...complete, groups: new Map(complete.groups) };
			const group = measurements.groups.get('container');
			if (!group) throw new Error('Expected a group measurement fixture');
			measurements.groups.set('container', { ...group, [field]: value });
			await expect(layoutGraph(graph.value, ranks, measurements), field).rejects.toThrow(
				`groups.container.${field}`,
			);
		}
	});

	it('defends the layout boundary against inconsistent graph and rank structures', async () => {
		const document = validLogicDocument();
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected an acyclic graph');
		const ranks = topologicallyRank(graph.value);
		const measurements = layoutMeasurementsFor(document);

		await expect(
			layoutGraph(
				{ ...graph.value, rankableEndpointIds: ['missing-endpoint'] },
				{ byEndpointId: new Map([['missing-endpoint', 0]]), bands: [['missing-endpoint']] },
				measurements,
			),
		).rejects.toThrow('Missing graph endpoint: missing-endpoint');

		await expect(
			layoutGraph(graph.value, { ...ranks, bands: [['missing-size']] }, measurements),
		).rejects.toThrow('Missing measured size: missing-size');

		const disconnectedGraph: LogicGraph = {
			...graph.value,
			outgoingByEndpointId: new Map(),
			predecessorsByEndpointId: new Map(),
		};
		const disconnectedLayout = await layoutGraph(disconnectedGraph, ranks, measurements);
		expect(disconnectedLayout.elements).toHaveLength(graph.value.endpointsById.size);

		const firstRelation = graph.value.relations[0];
		if (!firstRelation) throw new Error('Expected at least one relation');
		const inconsistentRelation: LogicGraph = {
			...graph.value,
			relations: [
				{
					...firstRelation,
					relation: { ...firstRelation.relation, from: 'missing-bounds' },
				},
			],
		};
		await expect(layoutGraph(inconsistentRelation, ranks, measurements)).rejects.toThrow(
			`Missing relation bounds: ${firstRelation.relation.id}`,
		);
	});

	it('rejects group containment cycles even when assembled outside validation', async () => {
		const base = validLogicDocument();
		const memberCycle: LogicDocument = {
			...base,
			groups: base.groups.map((group) =>
				group.id === 'container'
					? { ...group, groupId: 'orphan-group' }
					: group.id === 'orphan-group'
						? { ...group, groupId: 'container' }
						: group,
			),
		};
		const memberGraph = createGraph(memberCycle);
		if (!memberGraph.ok) throw new Error('Expected graph construction to accept group metadata');
		await expect(
			layoutGraph(
				memberGraph.value,
				topologicallyRank(memberGraph.value),
				layoutMeasurementsFor(memberCycle),
			),
		).rejects.toThrow('Group containment cycle at');

		const emptyCycle: LogicDocument = {
			...base,
			groups: [
				...base.groups,
				{ id: 'empty-a', label: 'Empty A', groupId: 'empty-b' },
				{ id: 'empty-b', label: 'Empty B', groupId: 'empty-a' },
			],
		};
		const emptyGraph = createGraph(emptyCycle);
		if (!emptyGraph.ok) throw new Error('Expected graph construction to accept group metadata');
		await expect(
			layoutGraph(
				emptyGraph.value,
				topologicallyRank(emptyGraph.value),
				layoutMeasurementsFor(emptyCycle),
			),
		).rejects.toThrow('Group containment cycle at');
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
