import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicNode,
	type LogicRelation,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { evaluateDedicatedLayout } from '../../../../src/lib/core/layout/layout-engine';
import {
	compareRankOrders,
	countRankOrderCrossings,
	documentaryRankOrder,
	enumerateRankOrders,
	type RankDomain,
	type RankOrder,
	type RankOrderAlgorithm,
	rankOrderEnumerationSize,
	type RankOrderInput,
	validateRankOrder,
} from '../../../../src/lib/core/layout/rank-order';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import {
	deriveEndpointRows,
	orderEndpoints,
} from '../../../../src/lib/core/ordering/endpoint-order';
import {
	type EndpointSlot,
	fractionalOrderKeySpace,
} from '../../../../src/lib/core/ordering/order-key-space';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

const bandSizes = fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 3 });
const domainCase = fc
	.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 8 })
	.chain((values) =>
		bandSizes.map((sizes) => {
			const pool = values.map((value) => `n${value}`);
			const bands: string[][] = [];
			let offset = 0;
			for (const size of sizes) {
				if (offset >= pool.length) break;
				bands.push(pool.slice(offset, offset + size));
				offset += size;
			}
			return { bands } satisfies RankDomain;
		}),
	);
const bandPermutationCase = domainCase.chain((domain) =>
	fc
		.shuffledSubarray(
			domain.bands.map((_, index) => index),
			{ minLength: domain.bands.length, maxLength: domain.bands.length },
		)
		.map((permutation) => ({ domain, permutation })),
);

const crossingCase = fc
	.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 2, maxLength: 8 })
	.chain((values) => {
		const ids = values.map((value) => `n${value}`);
		const sourceCount = Math.max(1, Math.min(3, ids.length - 1));
		const sources = ids.slice(0, sourceCount);
		const targets = ids.slice(sourceCount);
		const order: RankOrder = [targets, sources];
		return fc
			.array(fc.record({ from: fc.constantFrom(...sources), to: fc.constantFrom(...targets) }), {
				maxLength: 8,
			})
			.chain((relations) =>
				fc
					.shuffledSubarray(
						relations.map((_, index) => index),
						{ minLength: relations.length, maxLength: relations.length },
					)
					.map((permutation) => ({
						order,
						relations,
						permuted: permutation.map((index) => defined(relations[index])),
					})),
			);
	});

function corpusDocument(
	ids: readonly string[],
	layout: readonly string[],
	relations: readonly LogicRelation[],
): LogicDocument {
	const orderKeys = new Map<string, string>();
	let previous: string | undefined;
	for (const id of layout) {
		let slot: EndpointSlot = {};
		if (previous !== undefined) slot = { before: previous };
		previous = fractionalOrderKeySpace.keyFor(slot);
		orderKeys.set(id, previous);
	}
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'rank-order-property',
		title: 'Rank order property',
		layout: defined(layoutConfiguration(LayoutDirection.TopToBottom, LayoutBias.Top)),
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		junctions: [],
		nodes: ids.map((id) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: id,
			layoutOrder: defined(orderKeys.get(id)),
		})),
		relations,
	};
}

const documentCase = fc
	.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 6 })
	.chain((values) => {
		const ids = values.map((value) => `n${value}`);
		return fc
			.record({
				dag: fc.shuffledSubarray(ids, { minLength: ids.length, maxLength: ids.length }),
				layout: fc.shuffledSubarray(ids, { minLength: ids.length, maxLength: ids.length }),
				pairs: fc.array(fc.tuple(fc.nat(ids.length - 1), fc.nat(ids.length - 1)), {
					maxLength: 8,
				}),
			})
			.map(({ dag, layout, pairs }) => {
				const relations: LogicRelation[] = [];
				for (const [first, second] of pairs) {
					const low = Math.min(first, second);
					const high = Math.max(first, second);
					if (low === high) continue;
					relations.push({
						id: `r${relations.length}`,
						from: defined(dag[low]),
						to: defined(dag[high]),
					});
				}
				return corpusDocument(ids, layout, relations);
			});
	});

describe('rank order enumeration', () => {
	it('yields the whole permutation product, all valid and unique, deterministically', () => {
		fc.assert(
			fc.property(domainCase, (domain) => {
				const size = rankOrderEnumerationSize(domain);
				const orders = enumerateRankOrders(domain, size);
				expect(orders).toHaveLength(size);
				expect(new Set(orders.map((order) => JSON.stringify(order))).size).toBe(size);
				for (const order of orders) expect(validateRankOrder(domain, order)).toBe(true);
				expect(enumerateRankOrders(domain, size)).toEqual(orders);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('is deterministic under a permutation of the bands', () => {
		fc.assert(
			fc.property(bandPermutationCase, ({ domain, permutation }) => {
				const size = rankOrderEnumerationSize(domain);
				const orders = enumerateRankOrders(domain, size);
				const permutedDomain: RankDomain = {
					bands: permutation.map((index) => defined(domain.bands[index])),
				};
				const permuted = enumerateRankOrders(permutedDomain, size);
				const expected = orders.map((order) => permutation.map((index) => defined(order[index])));
				expect(
					permuted.map((order) => JSON.stringify(order)).sort(compareCanonicalStrings),
				).toEqual(expected.map((order) => JSON.stringify(order)).sort(compareCanonicalStrings));
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('refuses a budget below the product, a fractional budget and a negative budget', () => {
		const domain: RankDomain = { bands: [['a', 'b'], ['c']] };
		expect(rankOrderEnumerationSize(domain)).toBe(2);
		expect(() => enumerateRankOrders(domain, 1)).toThrow(/budget/);
		expect(() => enumerateRankOrders(domain, 1.5)).toThrow(/budget/);
		expect(() => enumerateRankOrders(domain, -1)).toThrow(/budget/);
	});
});

describe('rank order oracle edges', () => {
	it('accepts a bijection and rejects each falsification', () => {
		const domain: RankDomain = { bands: [['a', 'b'], ['c']] };
		expect(validateRankOrder(domain, [['b', 'a'], ['c']])).toBe(true);
		expect(validateRankOrder(domain, [['b', 'a']])).toBe(false);
		expect(validateRankOrder(domain, [['a'], ['c']])).toBe(false);
		expect(validateRankOrder(domain, [['a', 'x'], ['c']])).toBe(false);
		const repeated: RankDomain = { bands: [['a'], ['a', 'b']] };
		expect(validateRankOrder(repeated, [['a'], ['a', 'b']])).toBe(false);
	});

	it('counts one inversion and skips shared endpoints, other band pairs and missing ids', () => {
		const order: RankOrder = [
			['e', 'd'],
			['a', 'b'],
		];
		expect(
			countRankOrderCrossings(order, [
				{ from: 'a', to: 'd' },
				{ from: 'b', to: 'e' },
			]),
		).toBe(1);
		expect(
			countRankOrderCrossings(order, [
				{ from: 'a', to: 'd' },
				{ from: 'a', to: 'e' },
			]),
		).toBe(0);
		const threeBands: RankOrder = [['x'], ['y'], ['a', 'b']];
		expect(
			countRankOrderCrossings(threeBands, [
				{ from: 'a', to: 'x' },
				{ from: 'b', to: 'y' },
			]),
		).toBe(0);
		expect(
			countRankOrderCrossings(threeBands, [
				{ from: 'a', to: 'x' },
				{ from: 'y', to: 'x' },
			]),
		).toBe(0);
		expect(
			countRankOrderCrossings(order, [
				{ from: 'missing', to: 'e' },
				{ from: 'a', to: 'd' },
			]),
		).toBe(0);
		expect(
			countRankOrderCrossings(order, [
				{ from: 'a', to: 'missing' },
				{ from: 'b', to: 'd' },
			]),
		).toBe(0);
	});

	it('orders canonically across differing band and element lengths', () => {
		expect(compareRankOrders([['a']], [['a']])).toBe(0);
		expect(compareRankOrders([['a']], [['b']])).toBeLessThan(0);
		expect(compareRankOrders([['a']], [['a', 'b']])).toBeLessThan(0);
		expect(compareRankOrders([['a']], [['a'], ['b']])).toBeLessThan(0);
		expect(compareRankOrders([['a'], ['b']], [['a']])).toBeGreaterThan(0);
	});

	it('fills the ordering slot, honours an explicit key space and refuses a missing endpoint', () => {
		const domain: RankDomain = { bands: [['b', 'a']] };
		const endpoints: readonly LogicNode[] = ['a', 'b'].map((id) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: id,
			layoutOrder: orderKey(`a${id}`),
		}));
		const slot: RankOrderAlgorithm = documentaryRankOrder;
		const input: RankOrderInput = { endpoints, keySpace: fractionalOrderKeySpace };
		expect(slot(domain, input)).toEqual([['a', 'b']]);
		expect(() => documentaryRankOrder(domain, { endpoints: endpoints.slice(0, 1) })).toThrow();
	});
});

describe('rank order crossing oracle', () => {
	it('is invariant under a permutation of the relations', () => {
		fc.assert(
			fc.property(crossingCase, ({ order, relations, permuted }) => {
				expect(countRankOrderCrossings(order, permuted)).toBe(
					countRankOrderCrossings(order, relations),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});

describe('documentary rank order adapter', () => {
	it("reproduces the engine's placement rows order", () => {
		fc.assert(
			fc.property(documentCase, (document) => {
				const created = createGraph(document);
				if (!created.ok) return;
				const graph = created.value;
				const ranks = topologicallyRank(graph);
				const endpoints = [...document.groups, ...document.nodes, ...document.junctions];
				const documentary = documentaryRankOrder({ bands: ranks.bands }, { endpoints });
				const rows = deriveEndpointRows({
					effectiveEndpointOrder: orderEndpoints(endpoints),
					componentIds: graph.rankableEndpointIds,
					ranks: ranks.byEndpointId,
					junctionIds: new Set(),
					maximumRank: Math.max(0, ...ranks.byEndpointId.values()),
				});
				expect(documentary).toEqual(rows.ordinary);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});

describe('explicit ordinary row preparation', () => {
	it('preserves documentary packing while applying candidate order only within ordinary rows', () => {
		fc.assert(
			fc.property(documentCase, (document) => {
				const created = createGraph(document);
				if (!created.ok) return;
				const graph = created.value;
				const ranks = topologicallyRank(graph);
				const documentary = prepareLayout(graph, ranks);
				const candidate = documentary.rankOrderDomain.bands.map((band) => [...band].reverse());
				const reordered = prepareLayout(graph, ranks, candidate);

				expect(reordered.rankOrderDomain).toEqual(documentary.rankOrderDomain);
				expect(
					reordered.components.map(({ ids, effectiveOrder }) => ({ ids, effectiveOrder })),
				).toEqual(
					documentary.components.map(({ ids, effectiveOrder }) => ({ ids, effectiveOrder })),
				);
				expect(reordered.containment).toEqual(documentary.containment);
				expect(reordered.components.flatMap(({ rows }) => rows.ordinary)).toEqual(candidate);
				expect(reordered.components.map(({ rows }) => rows.junction)).toEqual(
					documentary.components.map(({ rows }) => rows.junction),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects an order that changes the row domains', () => {
		const document = corpusDocument(
			['a', 'b', 'c'],
			['a', 'b', 'c'],
			[{ id: 'r', from: 'a', to: 'c' }],
		);
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected valid fixture graph');
		const ranks = topologicallyRank(graph.value);
		const structure = prepareLayout(graph.value, ranks);
		const order = structure.rankOrderDomain.bands.map((band) => [...band]);
		const firstBand = order[0];
		if (firstBand === undefined) throw new Error('Expected a rank band');
		order[0] = [...firstBand, 'outside-domain'];
		expect(() => prepareLayout(graph.value, ranks, order)).toThrow(
			/Invalid ordinary-row rank order/,
		);
	});
});

describe('dedicated layout evaluation with candidate row orders', () => {
	it('moves 3+1 boxes without changing logical ranks, group membership or endpoint IDs', () => {
		const base = corpusDocument(
			['a', 'b', 'c', 'd'],
			['a', 'b', 'c', 'd'],
			[
				{ id: 'r-a', from: 'a', to: 'd' },
				{ id: 'r-b', from: 'b', to: 'd' },
				{ id: 'r-c', from: 'c', to: 'd' },
			],
		);
		const document: LogicDocument = {
			...base,
			groups: [{ kind: EndpointKind.Group, id: 'g', label: 'Group', layoutOrder: orderKey('a2') }],
			nodes: base.nodes.map((node) => {
				if (node.id === 'a' || node.id === 'b') return { ...node, groupId: 'g' };
				return node;
			}),
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('Expected valid grouped graph');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const candidate = structure.rankOrderDomain.bands.map((band) => [...band].reverse());
		const measurements = {
			nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 40 }])),
			junctions: new Map(),
			groups: new Map([
				['g', { minimumWidth: 80, minimumHeight: 50, headerHeight: 20, padding: 8 }],
			]),
		};
		const baseline = evaluateDedicatedLayout(structure, measurements).result;
		const reordered = evaluateDedicatedLayout(
			prepareLayout(graph, ranks, candidate),
			measurements,
		).result;

		const baselinePositions = new Map(baseline.elements.map(({ id, bounds }) => [id, bounds.x]));
		const reorderedPositions = new Map(reordered.elements.map(({ id, bounds }) => [id, bounds.x]));
		expect([...baselinePositions].some(([id, x]) => reorderedPositions.get(id) !== x)).toBe(true);
		expect([...baselinePositions.keys()].sort(compareCanonicalStrings)).toEqual(
			[...reorderedPositions.keys()].sort(compareCanonicalStrings),
		);
		expect(reordered.elements.find(({ id }) => id === 'g')).toBeDefined();
		expect(ranks.byEndpointId).toEqual(topologicallyRank(graph).byEndpointId);
		expect(graph.document).toBe(document);
	});
});
