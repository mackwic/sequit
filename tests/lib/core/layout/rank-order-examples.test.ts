import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngineAndRankOrderWitness,
} from '../../../../src/lib/core/layout/layout-engine';
import {
	boundedRankOrderEnumerationSize,
	compareRankOrders,
	countRankOrderCrossings,
	documentaryRankOrder,
	enumerateRankOrders,
	lazyRankOrders,
	type RankDomain,
	type RankOrder,
	rankOrderEnumerationSize,
	rankOrderKendallDistance,
	validateRankOrder,
} from '../../../../src/lib/core/layout/rank/rank-order';
import { searchDedicatedRankOrders } from '../../../../src/lib/core/layout/rank/rank-order-search';
import { RankTopologyOracle } from '../../../../src/lib/core/layout/rank/rank-order-topology';
import { applyRankOrder, collectRankOrderDomain } from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';

function rankDocument(
	nodeIds: readonly string[],
	relations: readonly LogicDocument['relations'][number][],
	junctionIds: readonly string[] = [],
): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'rank-order-examples',
		title: 'Rank ordering examples',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		nodes: nodeIds.map((id, index) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: id,
			layoutOrder: orderKey(`a${index}`),
		})),
		junctions: junctionIds.map((id, index) => ({
			id,
			kind: EndpointKind.Junction,
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(`b${index + 10}`),
		})),
		relations: [...relations],
	};
}

function graphFor(document: LogicDocument): LogicGraph {
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('Expected a valid rank-order example graph');
	return graph.value;
}

function nodeMeasurements(document: LogicDocument) {
	return {
		nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 60 }])),
		groups: new Map(),
		junctions: new Map(document.junctions.map(({ id }) => [id, { width: 24, height: 24 }])),
	};
}

const crossingRelations = [
	{ id: 'b-to-d', from: 'b', to: 'd' },
	{ id: 'c-to-d', from: 'c', to: 'd' },
	{ id: 'a-to-d', from: 'a', to: 'd' },
	{ id: 'a-to-e', from: 'a', to: 'e' },
] as const;

describe('rank order deterministic examples', () => {
	it('enumerates every small permutation product and enforces its exact budget boundary', () => {
		const domain: RankDomain = { bands: [['a', 'b', 'c'], ['d', 'e']] };

		expect(rankOrderEnumerationSize(domain)).toBe(12);
		expect(boundedRankOrderEnumerationSize(domain, 12)).toBe(12);
		expect(boundedRankOrderEnumerationSize(domain, 11)).toBeUndefined();
		expect(boundedRankOrderEnumerationSize({ bands: [['a', 'b', 'c', 'd']] }, 12)).toBeUndefined();
		expect(boundedRankOrderEnumerationSize({ bands: [] }, 0)).toBeUndefined();
		const orders = enumerateRankOrders(domain, 12);
		expect(orders).toHaveLength(12);
		expect(new Set(orders.map((order) => JSON.stringify(order))).size).toBe(12);
		expect(orders.every((order) => validateRankOrder(domain, order))).toBe(true);
		expect(() => enumerateRankOrders(domain, 11)).toThrow(Error);
		expect(() => enumerateRankOrders(domain, 1.5)).toThrow(Error);
		expect(() => boundedRankOrderEnumerationSize(domain, -1)).toThrow(Error);
	});

	it('sorts a documentary band by layout key and canonical tie, then rejects a missing endpoint', () => {
		const domain: RankDomain = { bands: [['a', 'b', 'c']] };
		const endpoints: LogicDocument['nodes'] = [
			{ id: 'a', kind: EndpointKind.Node, natureId: 'task', markdown: 'A', layoutOrder: orderKey('a2') },
			{ id: 'b', kind: EndpointKind.Node, natureId: 'task', markdown: 'B', layoutOrder: orderKey('a1') },
			{ id: 'c', kind: EndpointKind.Node, natureId: 'task', markdown: 'C', layoutOrder: orderKey('a1') },
		];

		expect(documentaryRankOrder(domain, { endpoints })).toEqual([['b', 'c', 'a']]);
		expect(() => documentaryRankOrder(domain, { endpoints: endpoints.slice(0, 2) })).toThrow();
	});

	it('counts only inversions between distinct routes in the same pair of bands', () => {
		const documentary: RankOrder = [
			['a', 'b', 'c'],
			['d', 'e'],
		];
		const permuted: RankOrder = [
			['b', 'c', 'a'],
			['d', 'e'],
		];

		expect(countRankOrderCrossings(documentary, crossingRelations)).toBe(2);
		expect(countRankOrderCrossings(permuted, crossingRelations)).toBe(0);
		expect(countRankOrderCrossings(documentary, crossingRelations, 0)).toBe(1);
		expect(
			countRankOrderCrossings(documentary, [
				{ from: 'a', to: 'd' },
				{ from: 'missing', to: 'e' },
			]),
		).toBe(0);
		expect(
			countRankOrderCrossings(documentary, [
				{ from: 'a', to: 'missing' },
				{ from: 'b', to: 'e' },
			]),
		).toBe(0);
		expect(compareRankOrders(permuted, documentary)).toBeGreaterThan(0);
		expect(compareRankOrders([['a']], [['a', 'b']])).toBeLessThan(0);
		expect(compareRankOrders([['a'], ['b']], [['a']])).toBeGreaterThan(0);
	});

	it('puts the documentary rank first in lazy enumeration and measures its inversions', () => {
		const domain: RankDomain = { bands: [['c', 'a', 'b'], ['x', 'y']] };
		const documentary: RankOrder = [['b', 'c', 'a'], ['x', 'y']];
		const orders = [...lazyRankOrders(domain, documentary)];

		expect(orders[0]).toEqual(documentary);
		expect(orders).toHaveLength(12);
		expect(new Set(orders.map((order) => JSON.stringify(order))).size).toBe(12);
		expect(rankOrderKendallDistance(documentary, documentary)).toBe(0);
		expect(rankOrderKendallDistance([['a', 'c', 'b'], ['y', 'x']], documentary)).toBe(4);
		expect(() => [...lazyRankOrders(domain, [['x'], ['y']])]).toThrow(Error);
		expect(() => [...lazyRankOrders(domain, [['a', 'b', 'c']])]).toThrow(Error);
	});

	it('collects only exchangeable ordinary nodes and leaves fixed junction rows alone', () => {
		const document = rankDocument(
			['a', 'b', 'c', 'target', 'isolated'],
			[
				{ id: 'a-choice', from: 'a', to: 'choice' },
				{ id: 'b-choice', from: 'b', to: 'choice' },
				{ id: 'c-choice', from: 'c', to: 'choice' },
				{ id: 'choice-target', from: 'choice', to: 'target' },
			],
			['choice'],
		);
		const graph = graphFor(document);
		const structure = prepareLayout(graph, topologicallyRank(graph));
		const domain = collectRankOrderDomain(structure);

		expect(domain.bands).toEqual([['a', 'b', 'c']]);
		const original = structure.components.find(({ ids }) => ids.includes('a'));
		if (original === undefined) throw new Error('Expected a connected source component');
		const reordered = applyRankOrder(structure, domain, [['c', 'b', 'a']]);
		const changed = reordered.components.find(({ ids }) => ids.includes('a'));
		if (changed === undefined) throw new Error('Expected the reordered source component');
		expect(changed.rows.ordinary[defined(domain.locations[0]).rank]).toEqual(['c', 'b', 'a']);
		expect(changed.rows.junction).toEqual(original.rows.junction);
		expect(() => applyRankOrder(structure, domain, [['a', 'a', 'c']])).toThrow(Error);
	});


	it('selects a geometrically valid rank permutation that removes a real 3+1 crossing pattern', () => {
		const document = rankDocument(['a', 'b', 'c', 'd', 'e'], crossingRelations);
		const graph = graphFor(document);
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);
		const measurements = nodeMeasurements(document);
		const documentary = evaluateDedicatedLayout(structure, measurements, undefined, true);
		const selected = layoutWithDedicatedEngineAndRankOrderWitness(
			graph,
			ranks,
			measurements,
			{ inspectRouting: true },
		);
		const baselineValidation = validateDedicatedCandidate({
			graph,
			ranks,
			measurements,
			layout: documentary.result,
		});
		const selectedValidation = validateDedicatedCandidate({
			graph,
			ranks,
			measurements,
			layout: selected.layout,
		});
		const topology = new RankTopologyOracle(structure, domain);

		expect(domain.bands).toEqual([
			['d', 'e'],
			['a', 'b', 'c'],
		]);
		expect(topology.count(structure, domain.bands)).toBe(2);
		expect(topology.count(structure, [['d', 'e'], ['b', 'c', 'a']])).toBe(0);
		expect(baselineValidation.valid).toBe(true);
		expect(selectedValidation.valid).toBe(true);
		expect(selected.witness.mode).toBe('exact');
		expect(validateRankOrder(domain, selected.witness.selectedOrder)).toBe(true);
		expect(routeBridgeAnalysis(selected.layout.relations).crossings.length).toBeLessThan(
			routeBridgeAnalysis(documentary.result.relations).crossings.length,
		);
		expect(selected.witness.selectedOrder).not.toEqual(domain.bands);
		expect(selected.layout.relations.map(({ id }) => id).sort()).toEqual(
			document.relations.map(({ id }) => id).sort(),
		);
	});

	it('stops exact and heuristic search at a declared proposal boundary', () => {
		const document = rankDocument(['a', 'b', 'c', 'd', 'e'], crossingRelations);
		const graph = graphFor(document);
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);
		const measurements = nodeMeasurements(document);
		const baseline = evaluateDedicatedLayout(structure, measurements, undefined, true);
		const result = searchDedicatedRankOrders({
			structure,
			domain,
			measurements,
			baseline,
			evaluate: (order) =>
				evaluateDedicatedLayout(
					applyRankOrder(structure, domain, order),
					measurements,
					undefined,
					true,
				),
			limits: { completePipelines: 12, uniqueProposals: 1 },
		});

		expect(result.witness).toMatchObject({
			mode: 'exact',
			stop: 'proposal-budget',
			evaluated: 1,
			valid: 1,
			truncated: true,
			exhaustive: false,
		});
		expect(result.witness.selectedOrder).toEqual(domain.bands);
		expect(validateRankOrder(domain, result.witness.selectedOrder)).toBe(true);
		expect(result.witness.work.completePipelines).toBe(1);

		const heuristic = searchDedicatedRankOrders({
			structure,
			domain,
			measurements,
			baseline,
			evaluate: (order) =>
				evaluateDedicatedLayout(
					applyRankOrder(structure, domain, order),
					measurements,
					undefined,
					true,
				),
			limits: { completePipelines: 11, uniqueProposals: 1 },
		});
		expect(heuristic.witness).toMatchObject({
			mode: 'heuristic',
			stop: 'proposal-budget',
			proposed: 1,
			evaluated: 1,
			truncated: true,
			exhaustive: false,
		});
	});
});
