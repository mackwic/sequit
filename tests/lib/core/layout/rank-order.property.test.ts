import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	defined,
	EndpointKind,
	JunctionOperator,
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
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngine,
} from '../../../../src/lib/core/layout/layout-engine';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
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
import {
	applyRankOrder,
	collectRankOrderDomain,
} from '../../../../src/lib/core/layout/rank-ordering';
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

describe('ordinary node rank-order domains', () => {
	it('excludes isolated, empty and singleton rows and keeps junction rails fixed', () => {
		const base = corpusDocument(
			['a', 'b', 'c', 'd', 'isolated'],
			['a', 'b', 'c', 'd', 'isolated'],
			[
				{ id: 'a-in', from: 'a', to: 'j' },
				{ id: 'b-in', from: 'b', to: 'j' },
				{ id: 'c-in', from: 'c', to: 'j' },
				{ id: 'j-out', from: 'j', to: 'd' },
			],
		);
		const document: LogicDocument = {
			...base,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'j',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('b00'),
				},
			],
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('Expected valid junction fixture graph');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);

		// Independent fixture oracle: only a/b/c share an ordinary rank with an exchange choice.
		expect(domain.bands).toEqual([['a', 'b', 'c']]);
		expect(domain.locations).toHaveLength(1);
		const component = structure.components.find(({ ids }) => ids.includes('a'));
		if (component === undefined) throw new Error('Expected connected component');
		const originalJunctionRows = component.rows.junction;
		const reordered = applyRankOrder(structure, domain, [['c', 'b', 'a']]);
		const reorderedComponent = reordered.components.find(({ ids }) => ids.includes('a'));
		if (reorderedComponent === undefined) throw new Error('Expected reordered component');
		expect(reorderedComponent.rows.junction).toEqual(originalJunctionRows);
		expect(reorderedComponent.rows.ordinary[defined(domain.locations[0]).rank]).toEqual([
			'c',
			'b',
			'a',
		]);
		expect(collectRankOrderDomain(reordered).bands.map((band) => [...band].sort())).toEqual(
			domain.bands.map((band) => [...band].sort()),
		);
		expect(
			structure.components.find(({ ids }) => ids.includes('isolated'))?.rows.ordinary,
		).toHaveLength(2);
		const measurements = {
			nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 40 }])),
			junctions: new Map([['j', { width: 20, height: 20 }]]),
			groups: new Map(),
		};
		const publicResult = layoutWithDedicatedEngine(graph, ranks, measurements);
		const explicitResult = evaluateDedicatedLayout(
			applyRankOrder(structure, domain, domain.bands),
			measurements,
		);
		expect(explicitResult).toEqual(publicResult);
		const publicInspected = layoutWithDedicatedEngine(graph, ranks, measurements, {
			inspectRouting: true,
		});
		const explicitInspection = evaluateDedicatedLayout(
			applyRankOrder(structure, domain, domain.bands),
			measurements,
			{ inspectRouting: true },
			true,
		);
		expect(explicitInspection.complete()).toEqual(publicInspected);
	});

	it('pins relation-endpoint groups and rejects them as candidate nodes', () => {
		const base = corpusDocument(
			['a', 'b', 'c', 'd'],
			['a', 'b', 'c', 'd'],
			[
				{ id: 'a-d', from: 'a', to: 'd' },
				{ id: 'b-d', from: 'b', to: 'd' },
				{ id: 'c-d', from: 'c', to: 'd' },
				{ id: 'g-d', from: 'g', to: 'd' },
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
		const structure = prepareLayout(created.value, topologicallyRank(created.value));
		const domain = collectRankOrderDomain(structure);
		expect(domain.bands).toEqual([['a', 'b', 'c']]);
		const original = structure.components.find(({ ids }) => ids.includes('g'));
		if (original === undefined) throw new Error('Expected group relation component');
		const originalRow = original.rows.ordinary.find((row) => row.includes('g'));
		if (originalRow === undefined) throw new Error('Expected group ordinary row');
		const groupPosition = originalRow.indexOf('g');
		const reordered = applyRankOrder(structure, domain, [['c', 'b', 'a']]);
		const changed = reordered.components.find(({ ids }) => ids.includes('g'));
		if (changed === undefined) throw new Error('Expected reordered group component');
		const changedRow = changed.rows.ordinary.find((row) => row.includes('g'));
		if (changedRow === undefined) throw new Error('Expected reordered group row');
		expect(changedRow.indexOf('g')).toBe(groupPosition);
		const measurements = {
			nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 40 }])),
			junctions: new Map(),
			groups: new Map([
				['g', { minimumWidth: 100, minimumHeight: 60, headerHeight: 20, padding: 8 }],
			]),
		};
		const baseline = evaluateDedicatedLayout(structure, measurements);
		const candidate = evaluateDedicatedLayout(reordered, measurements);
		const groupBounds = baseline.elements.find(({ id }) => id === 'g')?.bounds;
		const movedGroupBounds = candidate.elements.find(({ id }) => id === 'g')?.bounds;
		const baselineRelation = baseline.relations.find(({ id }) => id === 'g-d');
		const candidateRelation = candidate.relations.find(({ id }) => id === 'g-d');
		if (
			groupBounds === undefined ||
			movedGroupBounds === undefined ||
			baselineRelation === undefined ||
			candidateRelation === undefined
		)
			throw new Error('Expected group bounds and its incident relation');
		const startFace = (
			bounds: typeof groupBounds,
			point: (typeof baselineRelation.points)[number],
		) => {
			if (point.y === bounds.y) return 'top';
			if (point.y === bounds.y + bounds.height) return 'bottom';
			if (point.x === bounds.x) return 'left';
			if (point.x === bounds.x + bounds.width) return 'right';
			throw new Error('Expected group route to attach to a face');
		};
		expect(startFace(groupBounds, defined(baselineRelation.points[0]))).toBe(
			startFace(movedGroupBounds, defined(candidateRelation.points[0])),
		);
		for (const id of ['a', 'b']) {
			const memberBounds = baseline.elements.find(({ id: memberId }) => memberId === id)?.bounds;
			const movedMemberBounds = candidate.elements.find(
				({ id: memberId }) => memberId === id,
			)?.bounds;
			if (memberBounds === undefined || movedMemberBounds === undefined)
				throw new Error('Expected group member bounds');
			const enclosures: readonly (readonly [Bounds, Bounds])[] = [
				[groupBounds, memberBounds],
				[movedGroupBounds, movedMemberBounds],
			];
			for (const [container, member] of enclosures) {
				expect(member.x).toBeGreaterThanOrEqual(container.x);
				expect(member.y).toBeGreaterThanOrEqual(container.y);
				expect(member.x + member.width).toBeLessThanOrEqual(container.x + container.width);
				expect(member.y + member.height).toBeLessThanOrEqual(container.y + container.height);
			}
		}
		expect(() => applyRankOrder(structure, domain, [['a', 'b', 'c', 'g']])).toThrow(
			/Invalid ordinary-node rank order/,
		);
	});

	it('rejects candidate inputs with a duplicate, foreign ID or wrong band count', () => {
		const document = corpusDocument(
			['a', 'b', 'c'],
			['a', 'b', 'c'],
			[
				{ id: 'a-c', from: 'a', to: 'c' },
				{ id: 'b-c', from: 'b', to: 'c' },
			],
		);
		const graph = createGraph(document);
		if (!graph.ok) throw new Error('Expected valid fixture graph');
		const structure = prepareLayout(graph.value, topologicallyRank(graph.value));
		const domain = collectRankOrderDomain(structure);
		expect(domain.bands).toEqual([['a', 'b']]);
		expect(() => applyRankOrder(structure, domain, [['a', 'a']])).toThrow(
			/Invalid ordinary-node rank order/,
		);
		expect(() => applyRankOrder(structure, domain, [['a', 'outside-domain']])).toThrow(
			/Invalid ordinary-node rank order/,
		);
		expect(() => applyRankOrder(structure, domain, [])).toThrow(/Invalid ordinary-node rank order/);

		const twoBandDocument = corpusDocument(
			['a', 'b', 'c', 'd', 'isolated'],
			['a', 'b', 'c', 'd', 'isolated'],
			[
				{ id: 'a-c', from: 'a', to: 'c' },
				{ id: 'a-d', from: 'a', to: 'd' },
				{ id: 'b-c', from: 'b', to: 'c' },
				{ id: 'b-d', from: 'b', to: 'd' },
			],
		);
		const twoBandGraph = createGraph(twoBandDocument);
		if (!twoBandGraph.ok) throw new Error('Expected valid two-band graph');
		const twoBandStructure = prepareLayout(
			twoBandGraph.value,
			topologicallyRank(twoBandGraph.value),
		);
		const twoBandDomain = collectRankOrderDomain(twoBandStructure);
		expect(twoBandDomain.bands.map((band) => band.length)).toEqual([2, 2]);
		expect(() =>
			applyRankOrder(twoBandStructure, twoBandDomain, [
				['a', 'c'],
				['b', 'd'],
			]),
		).toThrow(/Invalid ordinary-node rank order/);
		const connectedIndex = defined(twoBandDomain.locations[0]).componentIndex;
		const connected = defined(twoBandStructure.components[connectedIndex]);
		const firstRank = defined(twoBandDomain.locations[0]).rank;
		const secondRank = defined(twoBandDomain.locations[1]).rank;
		const unchangedBandRef = defined(connected.rows.ordinary[secondRank]);
		const firstBand = defined(twoBandDomain.bands[0]);
		const secondBand = defined(twoBandDomain.bands[1]);
		const candidate: RankOrder = [[...firstBand].reverse(), secondBand];
		const reordered = applyRankOrder(twoBandStructure, twoBandDomain, candidate);
		const changedConnected = defined(reordered.components[connectedIndex]);
		expect(changedConnected).not.toBe(connected);
		expect(changedConnected.rows.ordinary[firstRank]).not.toBe(
			defined(connected.rows.ordinary[firstRank]),
		);
		expect(changedConnected.rows.ordinary[secondRank]).toBe(unchangedBandRef);
		const isolatedIndex = twoBandStructure.components.findIndex(({ ids }) =>
			ids.includes('isolated'),
		);
		expect(reordered.components[isolatedIndex]).toBe(twoBandStructure.components[isolatedIndex]);
		const returnedToDocumentary = applyRankOrder(reordered, twoBandDomain, twoBandDomain.bands);
		expect(returnedToDocumentary.components[connectedIndex].rows.ordinary[firstRank]).toEqual(
			connected.rows.ordinary[firstRank],
		);
	});
});

describe('dedicated layout evaluation with candidate row orders', () => {
	it('exchanges the 3+1 source nodes while retaining ranks, relations and identifiers', () => {
		const document = corpusDocument(
			['a', 'b', 'c', 'd'],
			['a', 'b', 'c', 'd'],
			[
				{ id: 'r-a', from: 'a', to: 'd' },
				{ id: 'r-b', from: 'b', to: 'd' },
				{ id: 'r-c', from: 'c', to: 'd' },
			],
		);
		const created = createGraph(document);
		if (!created.ok) throw new Error('Expected valid 3+1 fixture graph');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);
		const candidate = domain.bands.map((band) => [...band].reverse());
		const measurements = {
			nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 40 }])),
			junctions: new Map(),
			groups: new Map(),
		};
		const documentSnapshot = structuredClone(document);
		const graphSnapshot = structuredClone(graph);
		const measurementsSnapshot = structuredClone(measurements);
		const baseline = evaluateDedicatedLayout(structure, measurements);
		const reordered = evaluateDedicatedLayout(
			applyRankOrder(structure, domain, candidate),
			measurements,
		);
		if ('complete' in baseline || 'complete' in reordered)
			throw new Error('Ordinary evaluations must return LayoutResult directly');
		const sourceOrder = (layout: typeof baseline) =>
			layout.elements
				.filter(({ id }) => ['a', 'b', 'c'].includes(id))
				.sort((left, right) => left.bounds.x - right.bounds.x)
				.map(({ id }) => id);
		expect(sourceOrder(baseline)).toEqual(['a', 'b', 'c']);
		expect(sourceOrder(reordered)).toEqual(['c', 'b', 'a']);
		expect(ranks.byEndpointId.get('a')).toBe(1);
		expect(ranks.byEndpointId.get('b')).toBe(1);
		expect(ranks.byEndpointId.get('c')).toBe(1);
		expect(ranks.byEndpointId.get('d')).toBe(0);
		expect(reordered.elements.map(({ id }) => id).sort(compareCanonicalStrings)).toEqual(
			baseline.elements.map(({ id }) => id).sort(compareCanonicalStrings),
		);
		expect(reordered.relations.map(({ id }) => id).sort(compareCanonicalStrings)).toEqual([
			'r-a',
			'r-b',
			'r-c',
		]);
		expect(document).toEqual(documentSnapshot);
		expect(graph).toEqual(graphSnapshot);
		expect(measurements).toEqual(measurementsSnapshot);
	});
});
