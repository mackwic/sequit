import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
} from '../../src/lib/collaboration/yjs-live-document';
import type { LogicDocument } from '../../src/lib/document/logic-document';
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
});

describe('topologicallyRank', () => {
	it('uses longest-path ranks without giving structural groups or junctions a node row', async () => {
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
			const rankIncrement = graph.endpointsById.get(endpointId)?.kind === 'junction' ? 0 : 1;
			const expected =
				endpointPredecessors.length === 0
					? 0
					: Math.max(
							...endpointPredecessors.map(
								(predecessor) => (ranks.byEndpointId.get(predecessor) ?? -1) + rankIncrement,
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

	it('uses defensive defaults for an externally assembled graph', () => {
		const document = validLogicDocument();
		const source = document.nodes[0];
		const graph: LogicGraph = {
			document,
			endpointsById: new Map([
				['source', { kind: 'node', entity: source }],
				['isolated', { kind: 'node', entity: source }],
			]),
			relations: [],
			rankableEndpointIds: ['source', 'isolated'],
			outgoingByEndpointId: new Map([['source', ['external-target']]]),
			predecessorsByEndpointId: new Map(),
		};

		const ranks = topologicallyRank(graph);
		expect(ranks.byEndpointId.get('source')).toBe(0);
		expect(ranks.byEndpointId.get('external-target')).toBe(1);
		expect(ranks.byEndpointId.get('isolated')).toBe(0);
	});

	it('rejects a cyclic graph assembled outside createGraph', () => {
		const document = validLogicDocument();
		const source = document.nodes[0];
		const graph: LogicGraph = {
			document,
			endpointsById: new Map([['source', { kind: 'node', entity: source }]]),
			relations: [],
			rankableEndpointIds: ['source'],
			outgoingByEndpointId: new Map([['source', ['source']]]),
			predecessorsByEndpointId: new Map([['source', ['source']]]),
		};

		expect(() => topologicallyRank(graph)).toThrow('LogicGraph must be acyclic before ranking');
	});
});
