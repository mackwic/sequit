import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
} from '../../src/lib/collaboration/yjs-document-codec';
import { EndpointKind, type LogicDocument } from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';
import { createGraph, type LogicGraph } from '../../src/lib/graph/create-graph';
import { topologicallyRank } from '../../src/lib/graph/topological-ranks';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { validLogicDocument } from '../builders/logic-document';
import { openReferenceLiveDocument } from '../harnesses/open-live-document';
import { withCycle } from '../perturbators/logic-document';
import { withReorderedTables } from '../perturbators/sequit-source';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

function graphFrom(document: LogicDocument): LogicGraph {
	const result = createGraph(document);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected an acyclic graph');
	return result.value;
}

function currentDocumentFrom(source: string): LogicDocument {
	const parsed = parseSequitToml(source);
	if (!parsed.ok) throw new Error('Expected source to parse');
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, parsed.value);
	const current = readLogicDocument(ydoc);
	if (!current.ok) throw new Error('Expected Y.Doc to be readable');
	return current.value;
}

describe('LogicGraph', () => {
	it('resolves all relations including nodes, a junction, and the empty group endpoint', async () => {
		const graph = graphFrom(await openReferenceLiveDocument());
		const xorInputs = graph.relations.filter(
			({ target }) => target.entity.id === 'word-ui-options',
		);
		const xorOutputs = graph.relations.filter(
			({ source }) => source.entity.id === 'word-ui-options',
		);
		const dataTeamRelation = graph.relations.find(
			({ relation }) => relation.id === 'data-team-to-ai-content-generation',
		);

		expect(graph.relations).toHaveLength(20);
		expect(graph.endpointsById.get('word-ui-options')?.kind).toBe('junction');
		expect(xorInputs).toHaveLength(3);
		expect(xorOutputs).toHaveLength(1);
		expect(graph.endpointsById.get('data-team')).toMatchObject({ kind: 'group' });
		expect(dataTeamRelation?.source).toBe(graph.endpointsById.get('data-team'));
	});

	it('rejects an unknown endpoint at the relation field', async () => {
		const document = await openReferenceLiveDocument();
		const invalid: LogicDocument = {
			...document,
			relations: document.relations.map((relation, index) =>
				index === 0 ? { ...relation, from: 'missing-endpoint' } : relation,
			),
		};

		const result = createGraph(invalid);

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'unknown-endpoint',
					message: 'Unknown relation source: missing-endpoint',
					path: ['relations', document.relations[0]?.id, 'from'],
				},
			],
		});
	});

	it('returns the complete introduced cycle', async () => {
		const result = createGraph(withCycle(await openReferenceLiveDocument()));

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected a cycle');
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'cycle',
				cycle: ['ai-content-generation', 'reduce-documentary-effort', 'ai-content-generation'],
			}),
		);
	});
	it('reports both missing fields of a relation instead of stopping at the first', () => {
		const document = validLogicDocument();
		const invalid: LogicDocument = {
			...document,
			relations: [{ id: 'broken', from: 'missing-source', to: 'missing-target' }],
		};

		expect(createGraph(invalid)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'unknown-endpoint',
					message: 'Unknown relation source: missing-source',
					path: ['relations', 'broken', 'from'],
				},
				{
					code: 'unknown-endpoint',
					message: 'Unknown relation target: missing-target',
					path: ['relations', 'broken', 'to'],
				},
			],
		});
	});

	it('detects a self-cycle as a complete closed path', () => {
		const document = validLogicDocument();
		const result = createGraph({
			...document,
			relations: [{ id: 'self', from: 'source-a', to: 'source-a' }],
		});

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'cycle',
					message: 'Cycle detected: source-a -> source-a',
					path: ['relations'],
					cycle: ['source-a', 'source-a'],
				},
			],
		});
	});

	it.each([
		[
			'direct',
			[
				{
					kind: EndpointKind.Group as const,
					id: 'group-a',
					label: 'A',
					groupId: 'group-a',
					layoutOrder: orderKey('a0'),
				},
			],
			['group-a', 'group-a'],
		],
		[
			'indirect',
			[
				{
					kind: EndpointKind.Group as const,
					id: 'group-a',
					label: 'A',
					groupId: 'group-b',
					layoutOrder: orderKey('a0'),
				},
				{
					kind: EndpointKind.Group as const,
					id: 'group-b',
					label: 'B',
					groupId: 'group-a',
					layoutOrder: orderKey('a1'),
				},
			],
			['group-a', 'group-b', 'group-a'],
		],
	] as const)('rejects a %s group containment cycle before expansion', (_kind, groups, cycle) => {
		const result = createGraph({ ...validLogicDocument(), groups, nodes: [], relations: [] });

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'group-cycle',
					message: `Group nesting cycle: ${cycle.join(' -> ')}`,
					path: ['groups', cycle.at(-2), 'group'],
					cycle,
				},
			],
		});
	});

	it('canonicalizes relations and adjacency independently of input array order', () => {
		const document = validLogicDocument();
		const original = graphFrom(document);
		const reordered = graphFrom({
			...document,
			nodes: [...document.nodes].reverse(),
			groups: [...document.groups].reverse(),
			junctions: [...document.junctions].reverse(),
			relations: [...document.relations].reverse(),
		});

		expect(reordered.relations.map(({ relation }) => relation.id)).toEqual(
			original.relations.map(({ relation }) => relation.id),
		);
		expect([...reordered.outgoingByEndpointId]).toEqual([...original.outgoingByEndpointId]);
		expect([...reordered.predecessorsByEndpointId]).toEqual([...original.predecessorsByEndpointId]);
	});

	it('retains canonical deduplicated endpoints without expanding group relations', () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'source-group',
					label: 'Sources',
					layoutOrder: orderKey('a0'),
				},
				{
					kind: EndpointKind.Group,
					id: 'nested-source-group',
					label: 'Nested sources',
					groupId: 'source-group',
					layoutOrder: orderKey('a1'),
				},
				{
					kind: EndpointKind.Group,
					id: 'target-group',
					label: 'Targets',
					layoutOrder: orderKey('a2'),
				},
				{
					kind: EndpointKind.Group,
					id: 'empty-group',
					label: 'Empty',
					layoutOrder: orderKey('a3'),
				},
				{
					kind: EndpointKind.Group,
					id: 'nested-empty-group',
					label: 'Nested empty',
					groupId: 'source-group',
					layoutOrder: orderKey('a3'),
				},
			],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'source-a',
					natureId: 'goal',
					groupId: 'source-group',
					markdown: 'A',
					layoutOrder: orderKey('a4'),
				},
				{
					id: 'source-b',
					kind: EndpointKind.Node,
					natureId: 'goal',
					groupId: 'nested-source-group',
					markdown: 'B',
					layoutOrder: orderKey('a5'),
				},
				{
					kind: EndpointKind.Node,
					id: 'target-a',
					natureId: 'goal',
					groupId: 'target-group',
					markdown: 'A',
					layoutOrder: orderKey('a6'),
				},
				{
					kind: EndpointKind.Node,
					id: 'target-b',
					natureId: 'goal',
					groupId: 'target-group',
					markdown: 'B',
					layoutOrder: orderKey('a7'),
				},
			],
			junctions: [],
			relations: [
				{ id: 'expanded', from: 'source-group', to: 'target-group' },
				{ id: 'empty', from: 'empty-group', to: 'target-a' },
				{ id: 'direct', from: 'source-a', to: 'target-a' },
			],
		};

		const graph = graphFrom(document);
		const expanded = graph.effectiveRelations.find(({ relationId }) => relationId === 'expanded');

		expect(expanded).toEqual({
			relationId: 'expanded',
			sourceIds: ['source-a', 'source-b'],
			targetIds: ['target-a', 'target-b'],
		});
		expect(expanded?.sourceIds).not.toContain('nested-empty-group');
		expect(graph.effectiveRelations).toContainEqual({
			relationId: 'direct',
			sourceIds: ['source-a'],
			targetIds: ['target-a'],
		});
		expect(graph.rankableEndpointIds).toContain('empty-group');
		expect(graph.rankableEndpointIds).not.toContain('nested-empty-group');
		expect(topologicallyRank(graph).byEndpointId.has('nested-empty-group')).toBe(false);
		expect(graph.effectiveRelations).toContainEqual({
			relationId: 'empty',
			sourceIds: ['empty-group'],
			targetIds: ['target-a'],
		});
		expect(
			graphFrom({
				...document,
				groups: [...document.groups].reverse(),
				nodes: [...document.nodes].reverse(),
				relations: [...document.relations].reverse(),
			}).effectiveRelations,
		).toEqual(graph.effectiveRelations);
	});

	it('stores group-to-group relation membership in linear structural space', () => {
		const sizes = [20, 40];
		const retainedSizes = sizes.map((size) => {
			const base = validLogicDocument();
			const groups = [
				{
					kind: EndpointKind.Group as const,
					id: 'sources',
					label: 'Sources',
					layoutOrder: orderKey('a0'),
				},
				{
					kind: EndpointKind.Group as const,
					id: 'targets',
					label: 'Targets',
					layoutOrder: orderKey('a1'),
				},
			];
			const nodes = Array.from({ length: size }, (_, index) => [
				{
					kind: EndpointKind.Node as const,
					id: `source-${index}`,
					natureId: 'goal',
					markdown: '',
					groupId: 'sources',
					layoutOrder: orderKey('a2'),
				},
				{
					kind: EndpointKind.Node as const,
					id: `target-${index}`,
					natureId: 'goal',
					markdown: '',
					groupId: 'targets',
					layoutOrder: orderKey('a3'),
				},
			]).flat();
			const graph = graphFrom({
				...base,
				groups,
				nodes,
				junctions: [],
				relations: [{ id: 'groups', from: 'sources', to: 'targets' }],
			});
			const relation = graph.effectiveRelations[0];
			expect(graph.effectiveRelations).toHaveLength(1);
			if (relation === undefined) throw new Error('Expected one effective relation');
			expect(relation.sourceIds).toHaveLength(size);
			expect(relation.targetIds).toHaveLength(size);
			return relation.sourceIds.length + relation.targetIds.length;
		});
		expect(retainedSizes).toEqual([40, 80]);
	});
});

describe('topologicallyRank', () => {
	it('uses the canonical junction-aware longest-path recurrence without structural groups', async () => {
		const graph = graphFrom(await openReferenceLiveDocument());
		const ranks = topologicallyRank(graph);
		const predecessors = new Map<string, string[]>();
		for (const { source, target } of graph.relations) {
			const values = predecessors.get(target.entity.id) ?? [];
			values.push(source.entity.id);
			predecessors.set(target.entity.id, values);
		}

		for (const [endpointId, rank] of ranks.byEndpointId) {
			const endpointPredecessors = predecessors.get(endpointId) ?? [];
			const increment = graph.endpointsById.get(endpointId)?.kind === EndpointKind.Junction ? 0 : 1;
			const expected =
				endpointPredecessors.length === 0
					? 0
					: increment +
						Math.max(
							...endpointPredecessors.map(
								(predecessor) => ranks.byEndpointId.get(predecessor) ?? -1,
							),
						);
			expect(rank, endpointId).toBe(expected);
		}
		expect(ranks.byEndpointId.get('onlyoffice')).toBe(0);
		expect(ranks.byEndpointId.get('all-edits-in-word')).toBe(0);
		expect(ranks.byEndpointId.has('use-cases')).toBe(false);
		expect(ranks.byEndpointId.get('data-team')).toBe(0);
	});

	it('is deterministic when TOML tables are reordered', async () => {
		const source = await aiDocumentaryEffortScenario();
		const original = topologicallyRank(graphFrom(currentDocumentFrom(source)));
		const reordered = topologicallyRank(
			graphFrom(currentDocumentFrom(withReorderedTables(source))),
		);

		expect([...reordered.byEndpointId]).toEqual([...original.byEndpointId]);
		expect(reordered.bands).toEqual(original.bands);
	});
	it('keeps independent sources together and applies longest-path ranks to a diamond', () => {
		const ranks = topologicallyRank(graphFrom(validLogicDocument()));

		expect(ranks.bands).toEqual([
			['choice', 'endpoint-group', 'isolated', 'source-a', 'source-b'],
			['target'],
		]);
		expect(ranks.byEndpointId.has('container')).toBe(false);
		expect(ranks.byEndpointId.has('orphan-group')).toBe(false);
	});
});
