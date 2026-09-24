import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import {
	type GraphCorridorCandidate,
	graphCorridorConflicts,
	GraphCorridorStatus,
	GraphCorridorUnknownReason,
} from '../../../../src/lib/core/layout/routing/graph-corridor-conflicts';

const sparseDocument: LogicDocument = {
	persistenceFormat: PERSISTENCE_FORMAT,
	id: 'sparse-corridor',
	title: 'Sparse adjacent ranks',
	layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	natures: [{ id: 'N', label: 'Action', color: '#00aa44' }],
	groups: [],
	nodes: ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'N',
		markdown: id,
		layoutOrder: orderKey(`a${index}`),
	})),
	junctions: [],
	relations: [
		{ id: 'a-d', from: 'a', to: 'd' },
		{ id: 'b-d', from: 'b', to: 'd' },
		{ id: 'c-d', from: 'c', to: 'd' },
		{ id: 'a-e', from: 'a', to: 'e' },
	],
};

const candidate: GraphCorridorCandidate = {
	sourceRank: 1,
	targetRank: 0,
	sourceOrder: ['a', 'b', 'c'],
	targetOrder: ['d', 'e'],
	passage: 'monotone-adjacent-corridor',
};

function realGraph(document: LogicDocument): LogicGraph {
	const result = createGraph(document);
	if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
	return result.value;
}

function analyze(document: LogicDocument, order: GraphCorridorCandidate = candidate) {
	const graph = realGraph(document);
	return graphCorridorConflicts(graph, topologicallyRank(graph), order);
}

describe('real-graph adjacent corridor conflicts', () => {
	it('deduces the sparse 3+1 witness separately for two candidate target orders', () => {
		const graph = realGraph(sparseDocument);
		const ranks = topologicallyRank(graph);
		expect(ranks.bands).toEqual([
			['d', 'e'],
			['a', 'b', 'c'],
		]);
		expect(graphCorridorConflicts(graph, ranks, candidate)).toEqual({
			status: GraphCorridorStatus.Deduced,
			conflicts: {
				status: 'deduced',
				inversions: [
					{ firstRelationId: 'a-e', secondRelationId: 'b-d' },
					{ firstRelationId: 'a-e', secondRelationId: 'c-d' },
				],
				forcedCrossed: ['a-e', 'b-d', 'c-d'],
				requiredSeparations: [
					{ endpointId: 'd', firstRelationId: 'a-d', secondRelationId: 'b-d' },
					{ endpointId: 'd', firstRelationId: 'a-d', secondRelationId: 'c-d' },
					{ endpointId: 'd', firstRelationId: 'b-d', secondRelationId: 'c-d' },
				],
			},
		});
		expect(graphCorridorConflicts(graph, ranks, { ...candidate, targetOrder: ['e', 'd'] })).toEqual(
			{
				status: GraphCorridorStatus.Deduced,
				conflicts: {
					status: 'deduced',
					inversions: [],
					forcedCrossed: [],
					requiredSeparations: [],
				},
			},
		);
	});

	it('normalizes document collection permutations while retaining the candidate row order', () => {
		const permuted: LogicDocument = {
			...sparseDocument,
			nodes: [...sparseDocument.nodes].reverse(),
			relations: [...sparseDocument.relations].reverse(),
		};
		expect(analyze(permuted)).toEqual(analyze(sparseDocument));
	});

	it('returns unknown for alternate passage, nonadjacent ranks and incomplete candidate rows', () => {
		expect(analyze(sparseDocument, { ...candidate, passage: 'other-passage' })).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.OtherPassage,
		});
		expect(analyze(sparseDocument, { ...candidate, sourceRank: 2 })).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.NonAdjacentRanks,
		});
		expect(analyze(sparseDocument, { ...candidate, sourceOrder: ['a', 'b'] })).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.IncompleteCandidateOrder,
		});
		expect(analyze(sparseDocument, { ...candidate, sourceOrder: ['a', 'a', 'c'] })).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.IncompleteCandidateOrder,
		});
		expect(analyze(sparseDocument, { ...candidate, targetRank: -1 })).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.NonAdjacentRanks,
		});
		expect(analyze(sparseDocument, { ...candidate, sourceRank: 4, targetRank: 3 })).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.IncompleteCandidateOrder,
		});
		expect(analyze(sparseDocument, { ...candidate, targetOrder: ['d', 'd'] })).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.IncompleteCandidateOrder,
		});
	});

	it('withholds deductions when effective relations cease to match direct provenance', () => {
		const graph = realGraph(sparseDocument);
		const ranks = topologicallyRank(graph);
		const first = defined(graph.effectiveRelations[0]);
		const direct = defined(graph.relations[0]);
		const inconsistent: readonly LogicGraph[] = [
			{ ...graph, effectiveRelations: graph.effectiveRelations.slice(1) },
			{ ...graph, relations: [direct, direct, ...graph.relations.slice(2)] },
			{
				...graph,
				effectiveRelations: [
					{ ...first, relationId: 'missing-direct-relation' },
					...graph.effectiveRelations.slice(1),
				],
			},
			{
				...graph,
				effectiveRelations: [
					{ ...first, targetIds: ['d', 'e'] },
					...graph.effectiveRelations.slice(1),
				],
			},
			{
				...graph,
				effectiveRelations: [{ ...first, sourceIds: ['b'] }, ...graph.effectiveRelations.slice(1)],
			},
			{
				...graph,
				effectiveRelations: [{ ...first, targetIds: ['e'] }, ...graph.effectiveRelations.slice(1)],
			},
		];
		for (const altered of inconsistent)
			expect(graphCorridorConflicts(altered, ranks, candidate)).toEqual({
				status: GraphCorridorStatus.Unknown,
				reason: GraphCorridorUnknownReason.ProjectedRelation,
			});
	});

	it('ignores unrelated higher-rank edges but refuses an incidence entering this corridor', () => {
		const extraNodes = ['x', 'y'].map((id, index) => ({
			...defined(sparseDocument.nodes[0]),
			id,
			markdown: id,
			layoutOrder: orderKey(`a${index + 5}`),
		}));
		const withHigherChain: LogicDocument = {
			...sparseDocument,
			nodes: [...sparseDocument.nodes, ...extraNodes],
			relations: [
				{ id: 'x-y', from: 'x', to: 'y' },
				...sparseDocument.relations,
				{ id: 'y-a', from: 'y', to: 'a' },
			],
		};
		const graph = realGraph(withHigherChain);
		const ranks = topologicallyRank(graph);
		expect(ranks.byEndpointId.get('x')).toBe(3);
		expect(ranks.byEndpointId.get('y')).toBe(2);
		expect(graphCorridorConflicts(graph, ranks, candidate)).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.ExternalIncidence,
		});
		const enteringTarget: LogicDocument = {
			...sparseDocument,
			nodes: [...sparseDocument.nodes, extraNodes[0]].filter((node) => node !== undefined),
			relations: [
				...sparseDocument.relations,
				{ id: 'x-d', from: 'x', to: 'd' },
				{ id: 'x-a', from: 'x', to: 'a' },
			],
		};
		expect(analyze(enteringTarget)).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.ExternalIncidence,
		});
	});

	it('keeps an empty corridor unknown when a stale rank snapshot supplies empty bands', () => {
		const graph = realGraph({ ...sparseDocument, relations: [] });
		const staleRanks = { byEndpointId: new Map<string, number>(), bands: [[], []] };
		expect(
			graphCorridorConflicts(graph, staleRanks, {
				...candidate,
				sourceOrder: [],
				targetOrder: [],
			}),
		).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.EmptyCorridor,
		});
	});

	it('does not infer a monotone corridor for an explicit shared-lane presentation', () => {
		const withLanes: LogicDocument = {
			...sparseDocument,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [
					{ id: 'S', label: 'Source', layoutOrder: orderKey('a0') },
					{ id: 'T', label: 'Target', layoutOrder: orderKey('a1') },
				],
			},
			nodes: sparseDocument.nodes.map((node) => {
				if (['a', 'b', 'c'].includes(node.id)) return { ...node, laneId: 'S' };
				return { ...node, laneId: 'T' };
			}),
		};
		expect(analyze(withLanes)).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.UnsupportedPresentation,
		});
	});

	it('returns unknown for groups, junctions, effective projections and external incidences', () => {
		const grouped: LogicDocument = {
			...sparseDocument,
			groups: [{ kind: EndpointKind.Group, id: 'G', label: 'Group', layoutOrder: orderKey('a5') }],
			nodes: sparseDocument.nodes.map((node) => {
				if (['a', 'b', 'c'].includes(node.id)) return { ...node, groupId: 'G' };
				return node;
			}),
			relations: [{ id: 'G-d', from: 'G', to: 'd' }],
		};
		expect(realGraph(grouped).effectiveRelations[0]?.sourceIds).toEqual(['a', 'b', 'c']);
		expect(analyze(grouped)).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.GroupOrJunction,
		});
		const withJunction: LogicDocument = {
			...sparseDocument,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'J',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a5'),
				},
			],
		};
		expect(analyze(withJunction)).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.GroupOrJunction,
		});
		const graph = realGraph(sparseDocument);
		const projected: LogicGraph = {
			...graph,
			effectiveRelations: graph.effectiveRelations.map((relation) => {
				if (relation.relationId === 'a-d') return { ...relation, sourceIds: ['a', 'b'] };
				return relation;
			}),
		};
		expect(graphCorridorConflicts(projected, topologicallyRank(graph), candidate)).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.ProjectedRelation,
		});
		const external: LogicDocument = {
			...sparseDocument,
			nodes: [
				...sparseDocument.nodes,
				{
					...defined(sparseDocument.nodes[0]),
					id: 'x',
					markdown: 'x',
					layoutOrder: orderKey('a5'),
				},
			],
			relations: [...sparseDocument.relations, { id: 'x-a', from: 'x', to: 'a' }],
		};
		expect(analyze(external)).toEqual({
			status: GraphCorridorStatus.Unknown,
			reason: GraphCorridorUnknownReason.ExternalIncidence,
		});
	});
});
