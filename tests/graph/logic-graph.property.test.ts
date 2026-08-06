import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createGraph, type LogicGraph } from '../../src/lib/graph/create-graph';
import { topologicallyRank } from '../../src/lib/graph/topological-ranks';
import {
	acyclicLogicDocumentArbitrary,
	cyclicLogicDocumentArbitrary,
	nodeId,
} from '../builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../builders/property-test-options';

function graphFor(document: Parameters<typeof createGraph>[0]): LogicGraph {
	const graph = createGraph(document);
	expect(graph.ok).toBe(true);
	if (!graph.ok) throw new Error('Expected a generated DAG');
	return graph.value;
}

function rankFor(ranks: ReadonlyMap<string, number>, id: string): number {
	const rank = ranks.get(id);
	expect(rank).toBeDefined();
	if (rank === undefined) throw new Error(`Missing generated rank: ${id}`);
	return rank;
}

function canonicalGraph(graph: LogicGraph) {
	return {
		relations: graph.relations.map(({ relation }) => relation),
		rankableEndpointIds: graph.rankableEndpointIds,
		outgoing: [...graph.outgoingByEndpointId],
		predecessors: [...graph.predecessorsByEndpointId],
	};
}

const dagDocumentArbitrary = acyclicLogicDocumentArbitrary({ minNodes: 2, maxNodes: 20 });

describe('generated logic graphs', () => {
	it('ranks every generated DAG after all of its predecessors deterministically', () => {
		fc.assert(
			fc.property(dagDocumentArbitrary, (document) => {
				const graph = graphFor(document);
				const first = topologicallyRank(graph);
				const second = topologicallyRank(graph);
				expect([...second.byEndpointId]).toEqual([...first.byEndpointId]);
				expect(second.bands).toEqual(first.bands);

				for (const relation of document.relations) {
					expect(rankFor(first.byEndpointId, relation.to)).toBeGreaterThan(
						rankFor(first.byEndpointId, relation.from),
					);
				}

				const rankedIds = first.bands.flat();
				expect(rankedIds).toHaveLength(document.nodes.length);
				expect(new Set(rankedIds).size).toBe(document.nodes.length);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('assigns every generated node its exact longest-path rank', () => {
		fc.assert(
			fc.property(dagDocumentArbitrary, (document) => {
				const graph = graphFor(document);
				const ranks = topologicallyRank(graph).byEndpointId;
				for (const id of graph.rankableEndpointIds) {
					const predecessors = graph.predecessorsByEndpointId.get(id) ?? [];
					let expected = 0;
					if (predecessors.length > 0) {
						expected =
							Math.max(...predecessors.map((predecessor) => rankFor(ranks, predecessor))) + 1;
					}
					expect(rankFor(ranks, id)).toBe(expected);
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects every relation whose source or target endpoint is absent', () => {
		fc.assert(
			fc.property(dagDocumentArbitrary, fc.boolean(), (document, missingSource) => {
				let from = nodeId(0);
				let to = 'missing-endpoint';
				let missingField = 'to';
				if (missingSource) {
					from = 'missing-endpoint';
					to = nodeId(0);
					missingField = 'from';
				}
				const relation = {
					id: 'relation-with-missing-endpoint',
					from,
					to,
				};
				const graph = createGraph({
					...document,
					relations: [...document.relations, relation],
				});
				expect(graph.ok).toBe(false);
				if (graph.ok) return;
				expect(graph.diagnostics).toContainEqual(
					expect.objectContaining({
						code: 'unknown-endpoint',
						path: ['relations', relation.id, missingField],
					}),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('canonicalizes generated graphs independently of relation input order', () => {
		fc.assert(
			fc.property(
				acyclicLogicDocumentArbitrary({ minNodes: 3, maxNodes: 20, minEdges: 2 }),
				(document) => {
					const reordered = { ...document, relations: [...document.relations].reverse() };
					const first = graphFor(document);
					const second = graphFor(reordered);
					expect(canonicalGraph(second)).toEqual(canonicalGraph(first));
					expect(topologicallyRank(second)).toEqual(topologicallyRank(first));
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects every generated directed cycle', () => {
		fc.assert(
			fc.property(cyclicLogicDocumentArbitrary, (document) => {
				const graph = createGraph(document);
				expect(graph.ok).toBe(false);
				if (graph.ok) return;
				expect(graph.diagnostics).toEqual([
					expect.objectContaining({ code: 'cycle', path: ['relations'] }),
				]);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
