import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import { rankOrderMutationCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-stability';
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
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import {
	routeBridgeAnalysis,
	routeRuns,
} from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import {
	DedicatedCandidateRejectionCode,
	validateDedicatedCandidate,
} from '../../../../src/lib/core/layout/dedicated-candidate-validation';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngine,
	layoutWithDedicatedEngineAndRankOrderWitness,
} from '../../../../src/lib/core/layout/layout-engine';
import type {
	Bounds,
	DedicatedLayoutEvaluation,
	LayoutMeasurements,
	LayoutOptions,
	LayoutResult,
} from '../../../../src/lib/core/layout/layout-types';
import {
	boundedRankOrderEnumerationSize,
	compareRankOrders,
	countRankOrderCrossings,
	documentaryRankOrder,
	enumerateRankOrders,
	lazyRankOrders,
	type RankDomain,
	type RankOrder,
	type RankOrderAlgorithm,
	rankOrderEnumerationSize,
	type RankOrderInput,
	rankOrderKendallDistance,
	validateRankOrder,
} from '../../../../src/lib/core/layout/rank-order';
import { barycentricSweep } from '../../../../src/lib/core/layout/rank-order-heuristic';
import { searchDedicatedRankOrders } from '../../../../src/lib/core/layout/rank-order-search';
import { selectDedicatedRankLayout } from '../../../../src/lib/core/layout/rank-order-selection';
import { RankTopologyOracle } from '../../../../src/lib/core/layout/rank-order-topology';
import {
	applyRankOrder,
	collectRankOrderDomain,
} from '../../../../src/lib/core/layout/rank-ordering';
import {
	type LayoutStructure,
	prepareLayout,
} from '../../../../src/lib/core/layout/structure/prepare-layout';
import {
	deriveEndpointRows,
	orderEndpoints,
} from '../../../../src/lib/core/ordering/endpoint-order';
import {
	type EndpointSlot,
	fractionalOrderKeySpace,
} from '../../../../src/lib/core/ordering/order-key-space';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { createYjsEntityMap } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { junctionObstacle } from '../../../support/fixtures/routing-obstacles';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

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
		expect(
			defined(returnedToDocumentary.components[connectedIndex]).rows.ordinary[firstRank],
		).toEqual(connected.rows.ordinary[firstRank]);
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

describe('bounded lazy rank orders', () => {
	it('distinguishes the exact twelve-order boundary from twenty-four without factorial overflow', () => {
		expect(
			boundedRankOrderEnumerationSize(
				{
					bands: [
						['a', 'b', 'c'],
						['d', 'e'],
					],
				},
				12,
			),
		).toBe(12);
		expect(boundedRankOrderEnumerationSize({ bands: [['a', 'b', 'c', 'd']] }, 12)).toBeUndefined();
		expect(boundedRankOrderEnumerationSize({ bands: [] }, 0)).toBeUndefined();
		expect(() => boundedRankOrderEnumerationSize({ bands: [] }, -1)).toThrow(/cap/);
		expect(
			boundedRankOrderEnumerationSize(
				{ bands: [Array.from({ length: 200 }, (_, index) => `${index}`)] },
				12,
			),
		).toBeUndefined();
	});

	it('visits documentary first, then every alternative exactly once, and measures inversions within bands', () => {
		const domain = {
			bands: [
				['c', 'a', 'b'],
				['y', 'x'],
			],
		};
		const documentary = [
			['b', 'c', 'a'],
			['x', 'y'],
		];
		const orders = [...lazyRankOrders(domain, documentary)];
		expect(() => [...lazyRankOrders(domain, [['x'], ['y']])]).toThrow(/documentary/);
		expect(orders[0]).toEqual(documentary);
		expect(orders).toHaveLength(12);
		expect(new Set(orders.map((order) => JSON.stringify(order))).size).toBe(12);
		expect(rankOrderKendallDistance(documentary, documentary)).toBe(0);
		expect(
			rankOrderKendallDistance(
				[
					['a', 'c', 'b'],
					['y', 'x'],
				],
				documentary,
			),
		).toBe(4);
	});
});

function routeCount(layout: LayoutResult): number {
	return [...layout.relations.values()].reduce(
		(total, relation) => total + routeRuns({ id: relation.id, points: relation.points }).length,
		0,
	);
}

interface OracleLayout {
	readonly order: RankOrder;
	readonly layout: LayoutResult;
	readonly crossings: number;
	readonly bridges: number;
	readonly topologicalCrossings: number;
}
/** Count direct relation-pair inversions on movable bands; fixed junctions cannot swap. */
function oracleTopologicalCrossings(order: RankOrder, relations: readonly LogicRelation[]): number {
	const positions = new Map(
		order.flatMap((band, rank) => band.map((id, index) => [id, { rank, index }] as const)),
	);
	let crossings = 0;
	for (const [index, left] of relations.entries()) {
		for (const right of relations.slice(index + 1)) {
			const sourceA = positions.get(left.from);
			const sourceB = positions.get(right.from);
			const targetA = positions.get(left.to);
			const targetB = positions.get(right.to);
			if (
				sourceA === undefined ||
				sourceB === undefined ||
				targetA === undefined ||
				targetB === undefined ||
				sourceA.rank !== sourceB.rank ||
				targetA.rank !== targetB.rank ||
				sourceA.rank === targetA.rank
			)
				continue;
			if ((sourceA.index - sourceB.index) * (targetA.index - targetB.index) < 0) crossings += 1;
		}
	}
	return crossings;
}

function oracleInversions(order: RankOrder, documentary: RankOrder): number {
	let inversions = 0;
	for (const [bandIndex, band] of order.entries()) {
		const original = defined(documentary[bandIndex]);
		for (let first = 0; first < band.length; first += 1)
			for (let second = first + 1; second < band.length; second += 1)
				if (original.indexOf(defined(band[first])) > original.indexOf(defined(band[second])))
					inversions += 1;
	}
	return inversions;
}

function compareOracleLayouts(
	left: OracleLayout,
	right: OracleLayout,
	documentary: RankOrder,
): number {
	const crossing = left.topologicalCrossings - right.topologicalCrossings;
	if (crossing !== 0) return crossing;
	const inversions =
		oracleInversions(left.order, documentary) - oracleInversions(right.order, documentary);
	if (inversions !== 0) return inversions;
	const leftIds = left.order.flat();
	const rightIds = right.order.flat();
	for (let index = 0; index < leftIds.length; index += 1) {
		const a = defined(leftIds[index]);
		const b = defined(rightIds[index]);
		if (a < b) return -1;
		if (a > b) return 1;
	}
	return 0;
}

function oracleLayout(
	order: RankOrder,
	layout: LayoutResult,
	relations: readonly LogicRelation[],
): OracleLayout {
	const analysis = routeBridgeAnalysis(layout.relations);
	return {
		order,
		layout,
		crossings: analysis.crossings.length,
		bridges: analysis.bridges.length,
		topologicalCrossings: oracleTopologicalCrossings(order, relations),
	};
}

/** Rendered routes gate admission; stable topological order ranks the surviving candidates. */
function admissibleOracleLayouts(
	candidates: OracleLayout[],
	documentaryOrder: RankOrder,
): OracleLayout[] {
	const documentary = candidates.find(({ order }) =>
		order.every((band, index) =>
			band.every((id, position) => id === defined(documentaryOrder[index])[position]),
		),
	);
	let admissible = candidates;
	if (documentary !== undefined)
		admissible = candidates.filter(
			({ crossings, bridges }) =>
				crossings < documentary.crossings ||
				(crossings === documentary.crossings && bridges <= documentary.bridges),
		);
	return admissible.sort((left, right) => compareOracleLayouts(left, right, documentaryOrder));
}

function damageRouteAttachment(layout: LayoutResult, relationIds: readonly string[]): LayoutResult {
	return {
		...layout,
		relations: layout.relations.map((relation) => {
			if (!relationIds.includes(relation.id)) return relation;
			const initial = defined(relation.points[0]);
			return {
				...relation,
				points: [{ ...initial, x: initial.x + 1000 }, ...relation.points.slice(1)],
			};
		}),
	};
}

/** Route real proposals before damaging a documentary baseline, local frontier, or assembled candidate. */
function corruptedCandidate(
	graph: LogicGraph,
	damage: (layout: LayoutResult) => LayoutResult,
	stage: 'baseline' | 'global' | 'local' = 'global',
): { readonly evaluate: typeof evaluateDedicatedLayout } {
	let globalPipelines = 0;
	function evaluate(
		structure: LayoutStructure,
		sizes: LayoutMeasurements,
		options?: LayoutOptions,
	): LayoutResult;
	function evaluate(
		structure: LayoutStructure,
		sizes: LayoutMeasurements,
		options: LayoutOptions | undefined,
		retained: true,
	): DedicatedLayoutEvaluation;
	function evaluate(
		structure: LayoutStructure,
		sizes: LayoutMeasurements,
		options: LayoutOptions = {},
		retained = false,
	): LayoutResult | DedicatedLayoutEvaluation {
		const actual = evaluateDedicatedLayout(structure, sizes, options, true);
		if (structure.graph === graph) globalPipelines += 1;
		if (
			(stage === 'local' && structure.graph !== graph) ||
			(stage === 'baseline' && structure.graph === graph && globalPipelines === 1) ||
			(stage === 'global' && structure.graph === graph && globalPipelines === 2)
		) {
			const rejected = damage(actual.result);
			if (retained) return { result: rejected, complete: () => rejected };
			return rejected;
		}
		if (retained) return actual;
		return actual.complete();
	}
	return { evaluate };
}

function assertCompleteOracle(
	document: LogicDocument,
	measurements: Parameters<typeof layoutWithDedicatedEngine>[2],
): OracleLayout[] {
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid oracle graph');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	const size = rankOrderEnumerationSize(domain);
	expect(size).toBeLessThanOrEqual(12);
	const candidates: OracleLayout[] = [];
	for (const order of enumerateRankOrders(domain, size)) {
		const layout = evaluateDedicatedLayout(applyRankOrder(structure, domain, order), measurements);
		if (validateDedicatedCandidate({ graph, ranks, measurements, layout }).valid)
			candidates.push(oracleLayout(order, layout, document.relations));
	}
	const admissible = admissibleOracleLayouts(candidates, domain.bands);
	const actual = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
	if (admissible.length > 0) expect(actual.layout).toEqual(defined(admissible[0]).layout);
	else expect(actual.layout).toEqual(evaluateDedicatedLayout(structure, measurements));
	expect(actual.witness.evaluated).toBeLessThanOrEqual(12);
	return admissible;
}

describe('dedicated bounded geometric rank search', () => {
	it('matches an independently enumerated valid-layout oracle, routes included', () => {
		for (const entry of rankOrderComparisonCorpus().slice(0, 2))
			assertCompleteOracle(entry.document, entry.measurements);
	});
	it('checks every validated junction geometry, not just ordinary-node diagrams', () => {
		const base = corpusDocument(
			['a', 'b', 'c', 'd'],
			['a', 'b', 'c', 'd'],
			[
				{ id: 'a-j', from: 'a', to: 'j' },
				{ id: 'b-j', from: 'b', to: 'j' },
				{ id: 'c-j', from: 'c', to: 'j' },
				{ id: 'j-d', from: 'j', to: 'd' },
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
		const candidates = assertCompleteOracle(document, {
			nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 40 }])),
			groups: new Map(),
			junctions: new Map([['j', { width: 24, height: 24 }]]),
		});
		expect(candidates.length).toBeGreaterThan(1);
	});

	it('agrees with a separate exhaustive geometric oracle across connected small topologies', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 3 }),
				fc.constantFrom(
					LayoutDirection.TopToBottom,
					LayoutDirection.BottomToTop,
					LayoutDirection.LeftToRight,
					LayoutDirection.RightToLeft,
				),
				(mask, direction) => {
					const edges: LogicRelation[] = [
						{ id: 'a-d', from: 'a', to: 'd' },
						{ id: 'a-e', from: 'a', to: 'e' },
						{ id: 'b-d', from: 'b', to: 'd' },
						{ id: 'c-e', from: 'c', to: 'e' },
					];
					if (mask & 1) edges.push({ id: 'b-e', from: 'b', to: 'e' });
					if (mask & 2) edges.push({ id: 'c-d', from: 'c', to: 'd' });
					let bias = LayoutBias.Top;
					if (direction === LayoutDirection.BottomToTop) bias = LayoutBias.Bottom;
					if (direction === LayoutDirection.LeftToRight) bias = LayoutBias.Left;
					if (direction === LayoutDirection.RightToLeft) bias = LayoutBias.Right;
					const base = corpusDocument(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e'], edges);
					const document = { ...base, layout: defined(layoutConfiguration(direction, bias)) };
					const created = createGraph(document);
					if (!created.ok) throw new Error('Invalid generated rank topology');
					const graph = created.value;
					const ranks = topologicallyRank(graph);
					const structure = prepareLayout(graph, ranks);
					const domain = collectRankOrderDomain(structure);
					expect(rankOrderEnumerationSize(domain)).toBe(12);
					const componentIds = new Set(
						domain.locations.flatMap(
							({ componentIndex }) => defined(structure.components[componentIndex]).ids,
						),
					);
					for (const { relation } of graph.relations)
						expect(componentIds.has(relation.from)).toBe(componentIds.has(relation.to));
					const measurements = {
						nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 60 }])),
						junctions: new Map(),
						groups: new Map(),
					};
					const options = { inspectRouting: true };
					const actual = layoutWithDedicatedEngineAndRankOrderWitness(
						graph,
						ranks,
						measurements,
						options,
					);
					const valid = enumerateRankOrders(domain, 12).flatMap((order) => {
						const layout = evaluateDedicatedLayout(
							applyRankOrder(structure, domain, order),
							measurements,
							options,
						);
						const validation = validateDedicatedCandidate({ graph, ranks, measurements, layout });
						if (validation.valid) return [oracleLayout(order, layout, document.relations)];
						return [];
					});
					const admissible = admissibleOracleLayouts(valid, domain.bands);
					if (admissible.length === 0) {
						expect(actual.witness.stop).toBe('baseline-fallback');
						expect(actual.layout).toEqual(
							evaluateDedicatedLayout(structure, measurements, options),
						);
					} else {
						expect(actual.layout).toEqual(defined(admissible[0]).layout);
						expect(actual.witness.valid).toBeGreaterThan(0);
					}
					expect(actual.witness.evaluated).toBeLessThanOrEqual(12);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('avoids complete pipelines for dominated orders around a physical junction', () => {
		const fixture = junctionObstacle(LayoutDirection.TopToBottom);
		const nodeIds = Object.keys(fixture.nodes);
		const base = corpusDocument(nodeIds, nodeIds, fixture.relations);
		const document: LogicDocument = {
			...base,
			junctions: [
				{
					id: 'j',
					kind: EndpointKind.Junction,
					operator: JunctionOperator.Xor,
					layoutOrder: fractionalOrderKeySpace.keyFor({
						before: defined(base.nodes.at(-1)).layoutOrder,
					}),
				},
			],
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('Invalid physical junction graph');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const measurements = {
			nodes: new Map(Object.entries(fixture.nodes)),
			junctions: new Map(Object.entries(defined(fixture.junctions))),
			groups: new Map(),
		};
		const options = { inspectRouting: true };
		const documentary = evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements, options);
		const selected = layoutWithDedicatedEngineAndRankOrderWitness(
			graph,
			ranks,
			measurements,
			options,
		);
		expect(selected.layout).toEqual(documentary);
		expect(selected.witness.proposed).toBeGreaterThan(1);
		expect(selected.witness.work.localCompletePipelines).toBe(1);
		expect(selected.witness.work.globalCompletePipelines).toBe(1);
	});

	it('leaves an ordinary graph without an exchange band unverified', () => {
		const wide = corpusDocument(
			Array.from({ length: 9 }, (_, index) => `n${index}`),
			Array.from({ length: 9 }, (_, index) => `n${index}`),
			[],
		);
		const created = createGraph(wide);
		if (!created.ok) throw new Error('Invalid wide fixture');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const measurements = {
			nodes: new Map(wide.nodes.map(({ id }) => [id, { width: 80, height: 40 }])),
			junctions: new Map(),
			groups: new Map(),
		};
		const result = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
		expect(result.layout).toEqual(
			evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements),
		);
		expect(result.witness).toMatchObject({
			mode: 'skipped',
			stop: 'no-band',
			evaluated: 1,
			valid: 0,
			unverified: 1,
			work: { validations: 0, routeRunsInspected: 0 },
		});
		const chainIds = Array.from({ length: 68 }, (_, index) => `chain-${index}`);
		const chain = corpusDocument(
			chainIds,
			chainIds,
			chainIds.slice(1).map((id, index) => ({
				id: `chain-route-${index}`,
				from: defined(chainIds[index]),
				to: id,
			})),
		);
		const connected = createGraph(chain);
		if (!connected.ok) throw new Error('Invalid long chain');
		const connectedResult = layoutWithDedicatedEngineAndRankOrderWitness(
			connected.value,
			topologicallyRank(connected.value),
			{
				nodes: new Map(chainIds.map((id) => [id, { width: 80, height: 40 }])),
				groups: new Map(),
				junctions: new Map(),
			},
		);
		expect(connectedResult.witness).toMatchObject({
			mode: 'skipped',
			stop: 'no-band',
			evaluated: 1,
			work: { validations: 0 },
		});
		const single = corpusDocument(['only'], ['only'], []);
		const one = createGraph(single);
		if (!one.ok) throw new Error('Invalid singleton');
		const oneResult = layoutWithDedicatedEngineAndRankOrderWitness(
			one.value,
			topologicallyRank(one.value),
			{
				nodes: new Map([['only', { width: 80, height: 40 }]]),
				junctions: new Map(),
				groups: new Map(),
			},
		);
		expect(oneResult.witness).toMatchObject({
			stop: 'no-band',
			evaluated: 1,
			valid: 0,
			unverified: 1,
		});
	});
	it('preserves an optimized rank order across an unrelated one-relation work frontier', () => {
		const entry = rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2');
		if (entry === undefined) throw new Error('Missing optimized crossing witness');
		const ids = Array.from({ length: 65 }, (_, index) => `chain-${index}`);
		const before: LogicDocument = {
			...entry.document,
			nodes: [
				...entry.document.nodes,
				...ids.map((id) => ({
					id,
					kind: EndpointKind.Node as const,
					natureId: 'task',
					markdown: id,
					layoutOrder: orderKey('a6'),
				})),
			],
			relations: [
				...entry.document.relations,
				...ids.slice(1).map((id, index) => ({
					id: `chain-route-${index}`,
					from: defined(ids[index]),
					to: id,
				})),
			],
		};
		const after: LogicDocument = {
			...before,
			relations: [
				...before.relations,
				{ id: 'extra-shortcut', from: defined(ids[0]), to: defined(ids[2]) },
			],
		};
		const measurements = {
			...entry.measurements,
			nodes: new Map<string, { width: number; height: number }>([
				...[...entry.measurements.nodes].map(([id, size]) => [id, { ...size, width: 60 }] as const),
				...ids.map((id) => [id, { width: 80, height: 40 }] as const),
			]),
		};
		const first = createGraph(before);
		const second = createGraph(after);
		if (!first.ok || !second.ok) throw new Error('Invalid edit at local rank boundary');
		const beforeRanks = topologicallyRank(first.value);
		const afterRanks = topologicallyRank(second.value);
		const prior = layoutWithDedicatedEngineAndRankOrderWitness(
			first.value,
			beforeRanks,
			measurements,
		);
		const edited = layoutWithDedicatedEngineAndRankOrderWitness(
			second.value,
			afterRanks,
			measurements,
		);
		const documentary = evaluateDedicatedLayout(
			prepareLayout(first.value, beforeRanks),
			measurements,
		);
		const causalIds = new Set(entry.document.relations.map(({ id }) => id));
		const crossings = (layout: LayoutResult) =>
			routeBridgeAnalysis(layout.relations.filter(({ id }) => causalIds.has(id))).crossings.length;
		const order = (layout: LayoutResult, ids: readonly string[]) =>
			[...ids].sort(
				(left, right) =>
					defined(layout.elements.find(({ id }) => id === left)).bounds.x -
					defined(layout.elements.find(({ id }) => id === right)).bounds.x,
			);
		expect(prior.witness.valid).toBeGreaterThan(0);
		expect(prior.layout).not.toEqual(documentary);
		expect(crossings(documentary)).toBe(1);
		expect(crossings(prior.layout)).toBe(0);
		expect(crossings(edited.layout)).toBe(0);
		expect(edited.witness.stop).not.toBe('shape-envelope');
		expect(edited.witness.evaluated).toBeGreaterThan(1);
		expect(order(edited.layout, ['a', 'b', 'c'])).toEqual(order(prior.layout, ['a', 'b', 'c']));
		expect(order(edited.layout, ['d', 'e'])).toEqual(order(prior.layout, ['d', 'e']));
		expect(edited.layout.relations.map(({ id }) => id)).toContain('extra-shortcut');
	});

	it('skips an unaffordable star before slicing without dropping a separate crossing optimum', () => {
		const entry = rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2');
		if (entry === undefined) throw new Error('Missing optimized crossing witness');
		const starIds = Array.from({ length: 47 }, (_, index) => `wide-${index}`);
		const document: LogicDocument = {
			...entry.document,
			nodes: [
				...entry.document.nodes,
				...starIds.map((id) => ({
					id,
					kind: EndpointKind.Node as const,
					natureId: 'task',
					markdown: id,
					layoutOrder: orderKey('a6'),
				})),
			],
			relations: [
				...entry.document.relations,
				...starIds.slice(1).map((id, index) => ({
					id: `wide-route-${index}`,
					from: id,
					to: defined(starIds[0]),
				})),
			],
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('Invalid disconnected star document');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const measurements = {
			...entry.measurements,
			nodes: new Map([
				...entry.measurements.nodes,
				...starIds.map((id) => [id, { width: 80, height: 40 }] as const),
			]),
		};
		const documentary = evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements);
		const result = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
		const crossingIds = new Set(entry.document.relations.map(({ id }) => id));
		const crossings = (layout: LayoutResult) =>
			routeBridgeAnalysis(layout.relations.filter(({ id }) => crossingIds.has(id))).crossings
				.length;
		const starOrder = (layout: LayoutResult) =>
			starIds
				.slice(1)
				.sort(
					(left, right) =>
						defined(layout.elements.find(({ id }) => id === left)).bounds.x -
						defined(layout.elements.find(({ id }) => id === right)).bounds.x,
				);
		expect(result.witness.skippedComponents).toBe(1);
		expect(result.witness.exhaustive).toBe(false);
		expect(result.witness.components).toHaveLength(1);
		expect(result.witness.components?.[0]?.pipelineLimit).toBe(12);
		expect(result.witness.valid).toBeGreaterThan(0);
		expect(crossings(documentary)).toBe(1);
		expect(crossings(result.layout)).toBe(0);
		expect(starOrder(result.layout)).toEqual(starOrder(documentary));
		const starGeometry = (layout: LayoutResult) => {
			const bounds = new Map(layout.elements.map(({ id, bounds }) => [id, bounds] as const));
			const relations = new Map(
				layout.relations.map((relation) => [relation.id, relation] as const),
			);
			return {
				sizes: starIds.map((id) => {
					const { width, height } = defined(bounds.get(id));
					return { width, height };
				}),
				ports: starIds.slice(1).map((id, index) => {
					const relation = defined(relations.get(`wide-route-${index}`));
					const source = defined(bounds.get(id));
					const target = defined(bounds.get(defined(starIds[0])));
					const from = defined(relation.points[0]);
					const to = defined(relation.points.at(-1));
					return {
						from: { x: from.x - source.x, y: from.y - source.y },
						to: { x: to.x - target.x, y: to.y - target.y },
					};
				}),
			};
		};
		expect(starGeometry(result.layout)).toEqual(starGeometry(documentary));
		const rejectedUnchangedRoute = corruptedCandidate(graph, (layout) =>
			damageRouteAttachment(layout, ['wide-route-0']),
		);
		const fallback = selectDedicatedRankLayout(graph, ranks, measurements, {
			options: {},
			evaluate: rejectedUnchangedRoute.evaluate,
		});
		expect(fallback.layout).toEqual(documentary);
		expect(fallback.witness.fallbackComponents).toHaveLength(1);
		expect(fallback.witness.fallbackComponents?.[0]).toContain('a');
		expect(fallback.witness.fallbackComponents?.[0]).not.toContain('wide-0');
	});

	it('skips a group projection whose effective dependency pairs exceed the bounded local envelope', () => {
		const base = defined(
			rankOrderComparisonCorpus().find(({ id }) => id === 'two-successors'),
		).document;
		const members = Array.from({ length: 70 }, (_, index) => ({
			...defined(base.nodes[0]),
			id: `member-${index}`,
			groupId: 'g',
			markdown: 'Member',
		}));
		const nodes = [...members, { ...defined(base.nodes[0]), id: 'sink', markdown: 'Sink' }];
		const document: LogicDocument = {
			...base,
			nodes,
			groups: [
				{
					id: 'g',
					kind: EndpointKind.Group,
					label: 'Members',
					layoutOrder: defined(base.nodes[0]).layoutOrder,
				},
			],
			relations: [{ id: 'g-sink', from: 'g', to: 'sink' }],
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('Invalid group-projection fanout');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const measurements = {
			nodes: new Map(nodes.map(({ id }) => [id, { width: 80, height: 40 }] as const)),
			groups: new Map([
				['g', { minimumWidth: 100, minimumHeight: 60, padding: 20, headerHeight: 20 }],
			]),
			junctions: new Map(),
		};
		const result = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
		expect(graph.effectiveRelations[0]?.sourceIds).toHaveLength(70);
		expect(result.witness).toMatchObject({
			mode: 'skipped',
			stop: 'shape-envelope',
			skippedComponents: 1,
		});
		expect(result.layout).toEqual(
			evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements),
		);
	});

	it('keeps unrelated grouped nodes and junctions outside the optimized local slice', () => {
		const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2'));
		const document: LogicDocument = {
			...entry.document,
			groups: [
				{
					id: 'separate-group',
					kind: EndpointKind.Group,
					label: 'Separate',
					layoutOrder: orderKey('a7'),
				},
			],
			nodes: [
				...entry.document.nodes,
				{
					id: 'separate-node',
					kind: EndpointKind.Node,
					natureId: 'task',
					markdown: 'Separate',
					groupId: 'separate-group',
					layoutOrder: orderKey('a8'),
				},
			],
			junctions: [
				{
					id: 'separate-junction',
					kind: EndpointKind.Junction,
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a9'),
				},
			],
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('Invalid disconnected group and junction document');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const measurements: LayoutMeasurements = {
			...entry.measurements,
			nodes: new Map([...entry.measurements.nodes, ['separate-node', { width: 80, height: 40 }]]),
			groups: new Map([
				['separate-group', { minimumWidth: 100, minimumHeight: 60, padding: 20, headerHeight: 20 }],
			]),
			junctions: new Map([['separate-junction', { width: 24, height: 24 }]]),
		};
		const documentary = evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements);
		const selected = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
		const selectedIds = new Set(selected.layout.elements.map(({ id }) => id));
		for (const id of ['separate-group', 'separate-node', 'separate-junction'])
			expect(selectedIds.has(id)).toBe(true);
		for (const id of ['a', 'b', 'c', 'd', 'e']) expect(selectedIds.has(id)).toBe(true);
		const crossingIds = new Set(entry.document.relations.map(({ id }) => id));
		const crossingCount = (layout: LayoutResult) =>
			routeBridgeAnalysis(layout.relations.filter(({ id }) => crossingIds.has(id))).crossings
				.length;
		expect(crossingCount(documentary)).toBeGreaterThan(0);
		expect(crossingCount(selected.layout)).toBeLessThanOrEqual(crossingCount(documentary));
		expect(selected.witness.components).toHaveLength(1);
		expect(selected.layout.relations.map(({ id }) => id)).toEqual(
			documentary.relations.map(({ id }) => id),
		);
		expect(
			validateDedicatedCandidate({ graph, ranks, measurements, layout: selected.layout }).valid,
		).toBe(true);
	});

	it('keeps the same selected band permutations under endpoint renames on real references and archetypes', () => {
		const archetypes = rankOrderMutationCorpus()
			.filter(({ id }) =>
				['evaporating-cloud', 'goal-implementation', 'decision-tree'].includes(id),
			)
			.map(({ before }) => before);
		for (const entry of [...rankOrderComparisonCorpus(), ...archetypes]) {
			const created = createGraph(entry.document);
			if (!created.ok) throw new Error(`Invalid rank reference ${entry.id}`);
			const graph = created.value;
			const original = layoutWithDedicatedEngineAndRankOrderWitness(
				graph,
				topologicallyRank(graph),
				entry.measurements,
			).witness.selectedOrder;
			for (const { id: oldId } of entry.document.nodes) {
				const renamedId = `z-renamed-${oldId}`;
				const rename = (id: string) => {
					if (id === oldId) return renamedId;
					return id;
				};
				const document = {
					...entry.document,
					nodes: entry.document.nodes.map((node) => ({ ...node, id: rename(node.id) })),
					relations: entry.document.relations.map((relation) => ({
						...relation,
						from: rename(relation.from),
						to: rename(relation.to),
					})),
				};
				const renamed = createGraph(document);
				if (!renamed.ok) throw new Error(`Invalid renamed rank reference ${entry.id}`);
				const measurements = {
					...entry.measurements,
					nodes: new Map(
						[...entry.measurements.nodes].map(([id, size]) => [rename(id), size] as const),
					),
				};
				const chosen = layoutWithDedicatedEngineAndRankOrderWitness(
					renamed.value,
					topologicallyRank(renamed.value),
					measurements,
				).witness.selectedOrder;
				expect(
					chosen.map((band) =>
						band.map((id) => {
							if (id === renamedId) return oldId;
							return id;
						}),
					),
				).toEqual(original);
			}
		}
	});

	it('counts long projected crossings deterministically when virtual nodes share an interpolated position', () => {
		const base = defined(
			rankOrderComparisonCorpus().find(({ id }) => id === 'adjacent-2+2'),
		).document;
		const document = {
			...base,
			relations: [
				{ id: 'a-b', from: 'a', to: 'b' },
				{ id: 'b-e', from: 'b', to: 'e' },
				{ id: 'c-d', from: 'c', to: 'd' },
				{ id: 'd-e', from: 'd', to: 'e' },
				{ id: 'a-e-1', from: 'a', to: 'e' },
				{ id: 'a-e-2', from: 'a', to: 'e' },
			],
		};
		for (const relations of [document.relations, [...document.relations].reverse()]) {
			const created = createGraph({ ...document, relations });
			if (!created.ok) throw new Error('Invalid parallel long-relation witness');
			const structure = prepareLayout(created.value, topologicallyRank(created.value));
			const domain = collectRankOrderDomain(structure);
			const topology = new RankTopologyOracle(structure, domain);
			expect(domain.bands).toEqual([
				['b', 'd'],
				['a', 'c'],
			]);
			expect(topology.count(structure, domain.bands)).toBe(0);
			expect(
				topology.count(structure, [
					['b', 'd'],
					['c', 'a'],
				]),
			).toBe(3);
		}
	});

	it('excludes a topology winner when the rendered goal-to-implementation tree has more crossings', () => {
		const entry = defined(
			rankOrderMutationCorpus().find(({ id }) => id === 'goal-implementation'),
		).before;
		const created = createGraph(entry.document);
		if (!created.ok) throw new Error('Invalid linked goal and implementation trees');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);
		const documentary = evaluateDedicatedLayout(structure, entry.measurements);
		const reversed = domain.bands.map((band) => {
			if (band.includes('build-alerts')) return [...band].reverse();
			return [...band];
		});
		const candidate = evaluateDedicatedLayout(
			applyRankOrder(structure, domain, reversed),
			entry.measurements,
		);
		const originalValidation = validateDedicatedCandidate({
			graph,
			ranks,
			measurements: entry.measurements,
			layout: documentary,
		});
		const alternateValidation = validateDedicatedCandidate({
			graph,
			ranks,
			measurements: entry.measurements,
			layout: candidate,
		});
		expect(originalValidation.valid).toBe(true);
		expect(alternateValidation.valid).toBe(true);
		if (!originalValidation.valid || !alternateValidation.valid)
			throw new Error('Invalid goal tree');
		const topology = new RankTopologyOracle(structure, domain);
		expect(topology.count(structure, reversed)).toBeLessThan(
			topology.count(structure, domain.bands),
		);
		expect(originalValidation.score.strictCrossings).toBe(3);
		expect(alternateValidation.score.strictCrossings).toBe(4);
		const selected = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, entry.measurements);
		expect(selected.witness.selectedOrder).not.toEqual(reversed);
		expect(selected.witness.selectedOrder).toEqual([
			['build-ui', 'build-alerts'],
			['goal-deliver', 'goal-observe'],
		]);
		const chosenValidation = validateDedicatedCandidate({
			graph,
			ranks,
			measurements: entry.measurements,
			layout: selected.layout,
		});
		expect(chosenValidation.valid && chosenValidation.score.strictCrossings).toBe(0);
	});

	it('preserves final rank choices under component packing permutations and validates every assembly', () => {
		const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2'));
		const secondNodes = entry.document.nodes.map((node) => ({ ...node, id: `x-${node.id}` }));
		const secondRelations = entry.document.relations.map((relation) => ({
			...relation,
			id: `x-${relation.id}`,
			from: `x-${relation.from}`,
			to: `x-${relation.to}`,
		}));
		fc.assert(
			fc.property(fc.integer({ min: 50, max: 160 }), (width) => {
				const observations: string[][] = [];
				for (const swapped of [false, true]) {
					let preceding: string | undefined;
					let orderedNodes = [...entry.document.nodes, ...secondNodes];
					if (swapped) orderedNodes = [...secondNodes, ...entry.document.nodes];
					const nodes = orderedNodes.map((node) => {
						if (preceding === undefined) preceding = fractionalOrderKeySpace.keyFor({});
						else preceding = fractionalOrderKeySpace.keyFor({ before: preceding });
						return { ...node, layoutOrder: preceding };
					});
					const document = {
						...entry.document,
						nodes,
						relations: [...entry.document.relations, ...secondRelations],
					};
					const created = createGraph(document);
					if (!created.ok) throw new Error('Invalid permuted weak components');
					const graph = created.value;
					const ranks = topologicallyRank(graph);
					const measurements = {
						...entry.measurements,
						nodes: new Map([
							...entry.measurements.nodes,
							...secondNodes.map(
								({ id }) => [id, defined(entry.measurements.nodes.get(id.slice(2)))] as const,
							),
							['a', { width, height: 60 }] as const,
						]),
					};
					const result = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
					const validation = validateDedicatedCandidate({
						graph,
						ranks,
						measurements,
						layout: result.layout,
					});
					expect(
						validateRankOrder(
							collectRankOrderDomain(prepareLayout(graph, ranks)),
							result.witness.selectedOrder,
						),
					).toBe(true);
					if (!validation.valid)
						expect(result.layout).toEqual(
							evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements),
						);
					for (const component of result.witness.components ?? []) {
						expect(component.witness.evaluated).toBeLessThanOrEqual(component.pipelineLimit);
						expect(component.witness.proposed).toBeLessThanOrEqual(48);
					}
					expect(result.witness.work.globalCompletePipelines).toBeLessThanOrEqual(4);
					const transverseOrder = (ids: readonly string[]) =>
						[...ids].sort(
							(left, right) =>
								defined(result.layout.elements.find(({ id }) => id === left)).bounds.x -
								defined(result.layout.elements.find(({ id }) => id === right)).bounds.x,
						);
					observations.push(
						transverseOrder(['a', 'b', 'c']),
						transverseOrder(['x-a', 'x-b', 'x-c']),
					);
				}
				expect(observations.slice(0, 2)).toEqual(observations.slice(2));
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('restores only the implicated component after a globally rejected assembled proposal', () => {
		const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2'));
		const nodes = [
			...entry.document.nodes,
			...entry.document.nodes.map((node) => ({ ...node, id: `x-${node.id}` })),
		];
		const relations = [
			...entry.document.relations,
			...entry.document.relations.map((relation) => ({
				...relation,
				id: `x-${relation.id}`,
				from: `x-${relation.from}`,
				to: `x-${relation.to}`,
			})),
		];
		const document = { ...entry.document, nodes, relations };
		const created = createGraph(document);
		if (!created.ok) throw new Error('Invalid two-component safety fixture');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const measurements = {
			...entry.measurements,
			nodes: new Map([
				...entry.measurements.nodes,
				...[...entry.measurements.nodes].map(([id, size]) => [`x-${id}`, size] as const),
			]),
		};
		// Corrupt one actual full-document candidate after routing: the independent
		// validator must reject its zero-width box and retain the other component's gain.
		const damagedLocals = corruptedCandidate(
			graph,
			(layout) => damageRouteAttachment(layout, ['a-d', 'x-a-d']),
			'local',
		);
		const locallyRejected = selectDedicatedRankLayout(graph, ranks, measurements, {
			options: {},
			evaluate: damagedLocals.evaluate,
		});
		expect(locallyRejected.layout).toEqual(
			evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements),
		);
		expect(locallyRejected.witness.valid).toBe(0);
		expect(locallyRejected.witness.rejected.length).toBeGreaterThan(0);
		const rejectedBox = corruptedCandidate(graph, (layout) => ({
			...layout,
			elements: layout.elements.map((element) => {
				if (element.id !== 'a') return element;
				return { ...element, bounds: { ...element.bounds, width: 0 } };
			}),
		}));
		const selected = selectDedicatedRankLayout(graph, ranks, measurements, {
			options: {},
			evaluate: rejectedBox.evaluate,
		});
		expect(selected.witness.work.localCompletePipelines).toBeGreaterThan(0);
		expect(selected.witness.work.localCompletePipelines).toBeLessThanOrEqual(24);
		expect(selected.witness.fallbackComponents).toHaveLength(1);
		expect(selected.witness.fallbackComponents?.[0]).toContain('a');
		expect(selected.witness.fallbackComponents?.[0]).not.toContain('x-a');
		expect(selected.witness.finalValidation).toEqual({ valid: true });
		expect(
			validateRankOrder(
				collectRankOrderDomain(prepareLayout(graph, ranks)),
				selected.witness.selectedOrder,
			),
		).toBe(true);
		expect(
			validateDedicatedCandidate({ graph, ranks, measurements, layout: selected.layout }).valid,
		).toBe(true);
		const transverseOrder = (ids: readonly string[]) =>
			[...ids].sort(
				(left, right) =>
					defined(selected.layout.elements.find(({ id }) => id === left)).bounds.x -
					defined(selected.layout.elements.find(({ id }) => id === right)).bounds.x,
			);
		expect(transverseOrder(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
		expect(transverseOrder(['x-a', 'x-b', 'x-c'])).toEqual(['x-a', 'x-c', 'x-b']);
		const rejectedRoute = corruptedCandidate(graph, (layout) =>
			damageRouteAttachment(layout, ['a-d']),
		);
		const routeFallback = selectDedicatedRankLayout(graph, ranks, measurements, {
			options: {},
			evaluate: rejectedRoute.evaluate,
		});
		expect(routeFallback.witness.fallbackComponents).toHaveLength(1);
		expect(routeFallback.witness.fallbackComponents?.[0]).toContain('a');
		expect(routeFallback.witness.fallbackComponents?.[0]).not.toContain('x-a');
		expect(
			validateDedicatedCandidate({ graph, ranks, measurements, layout: routeFallback.layout })
				.valid,
		).toBe(true);
		const unknownCause = corruptedCandidate(graph, (layout) => ({
			...layout,
			relations: [],
		}));
		const fullFallback = selectDedicatedRankLayout(graph, ranks, measurements, {
			options: {},
			evaluate: unknownCause.evaluate,
		});
		expect(fullFallback.layout).toEqual(
			evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements),
		);
		expect(fullFallback.witness.fallbackComponents).toHaveLength(2);
		expect(fullFallback.witness.finalValidation).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.RelationInventory,
		});
		const incidentDenied = selectDedicatedRankLayout(graph, ranks, measurements, {
			options: {},
			evaluate: evaluateDedicatedLayout,
			admit: () => false,
		});
		expect(incidentDenied.layout).toEqual(
			evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements),
		);
		expect(incidentDenied.witness.fallbackComponents).toHaveLength(2);
		expect(incidentDenied.witness.work.incidentAdmissions).toBe(1);
	});

	it('proves the documentary zero-route baseline optimal without another pipeline', () => {
		const entry = rankOrderComparisonCorpus().find(({ id }) => id === 'two-successors');
		if (entry === undefined) throw new Error('Missing zero-route corpus');
		const created = createGraph(entry.document);
		if (!created.ok) throw new Error('Invalid zero-route corpus');
		const graph = created.value;
		const result = layoutWithDedicatedEngineAndRankOrderWitness(
			graph,
			topologicallyRank(graph),
			entry.measurements,
		);
		expect(result.witness).toMatchObject({
			mode: 'skipped',
			stop: 'optimal-bound',
			evaluated: 1,
			valid: 1,
			exhaustive: true,
			truncated: false,
		});
	});

	it('rejects invalid alternatives even when their apparent score is better', () => {
		const entry = rankOrderComparisonCorpus()[0];
		if (entry === undefined) throw new Error('Missing rank corpus');
		const created = createGraph(entry.document);
		if (!created.ok) throw new Error('Invalid rank corpus graph');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);
		const baseline = evaluateDedicatedLayout(structure, entry.measurements, undefined, true);
		const forged = {
			result: { ...baseline.result, width: 0, relations: [] },
			complete: () => baseline.result,
		};
		const result = searchDedicatedRankOrders({
			structure,
			domain,
			measurements: entry.measurements,
			baseline,
			evaluate: () => forged,
			limits: { completePipelines: 12, uniqueProposals: 48 },
		});
		expect(result.selected?.order).toEqual(domain.bands);
		expect(result.witness.rejected.length).toBeGreaterThan(0);
		expect(
			result.witness.rejected.every(
				({ reason }) => reason.code === DedicatedCandidateRejectionCode.RelationInventory,
			),
		).toBe(true);
		expect(result.witness.valid + result.witness.rejected.length + result.witness.unverified).toBe(
			result.witness.evaluated,
		);
	});

	it('does not start a second geometry pipeline when the evaluation budget is one', () => {
		const entry = rankOrderComparisonCorpus()[0];
		if (entry === undefined) throw new Error('Missing rank corpus');
		const created = createGraph(entry.document);
		if (!created.ok) throw new Error('Invalid rank corpus graph');
		const structure = prepareLayout(created.value, topologicallyRank(created.value));
		const domain = collectRankOrderDomain(structure);
		const baseline = evaluateDedicatedLayout(structure, entry.measurements, undefined, true);
		let evaluations = 0;
		const result = searchDedicatedRankOrders({
			structure,
			domain,
			measurements: entry.measurements,
			baseline,
			evaluate: () => {
				evaluations += 1;
				return baseline;
			},
			limits: { completePipelines: 1, uniqueProposals: 48 },
		});
		expect(evaluations).toBe(0);
		expect(result.witness.evaluated).toBe(1);
		expect(result.witness.truncated).toBe(true);
		expect(result.witness.exhaustive).toBe(false);
		expect(result.selected?.evaluation).toBe(baseline);
		const proposalLimited = searchDedicatedRankOrders({
			structure,
			domain,
			measurements: entry.measurements,
			baseline,
			evaluate: () => {
				throw new Error('No proposal may be evaluated');
			},
			limits: { completePipelines: 12, uniqueProposals: 1 },
		});
		expect(proposalLimited.witness).toMatchObject({
			mode: 'exact',
			stop: 'proposal-budget',
			proposed: 1,
			evaluated: 1,
			exhaustive: false,
			truncated: true,
		});
	});

	it('falls back explicitly when an invalid documentary baseline exhausts its budget', () => {
		const entry = rankOrderComparisonCorpus()[0];
		if (entry === undefined) throw new Error('Missing rank corpus');
		const created = createGraph(entry.document);
		if (!created.ok) throw new Error('Invalid rank corpus graph');
		const structure = prepareLayout(created.value, topologicallyRank(created.value));
		const domain = collectRankOrderDomain(structure);
		const baseline = evaluateDedicatedLayout(structure, entry.measurements, undefined, true);
		let evaluations = 0;
		const invalid = { ...baseline, result: { ...baseline.result, width: 0 } };
		const result = searchDedicatedRankOrders({
			structure,
			domain,
			measurements: entry.measurements,
			baseline: invalid,
			evaluate: () => {
				evaluations += 1;
				return baseline;
			},
			limits: { completePipelines: 1, uniqueProposals: 1 },
		});
		expect(result.witness.stop).toBe('baseline-fallback');
		expect(result.selected).toBeUndefined();
		expect(result.unchangedBaseline).toBe(invalid);
		expect(evaluations).toBe(0);
	});

	it('selects a valid order when a routed documentary baseline fails independent validation', () => {
		const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2'));
		const created = createGraph(entry.document);
		if (!created.ok) throw new Error('Invalid geometric order witness');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		for (const damage of [
			(layout: LayoutResult) => damageRouteAttachment(layout, ['a-d']),
			(layout: LayoutResult) => ({ ...layout, relations: [] }),
		]) {
			const routedBaseline = corruptedCandidate(graph, damage, 'baseline');
			const selected = selectDedicatedRankLayout(graph, ranks, entry.measurements, {
				options: {},
				evaluate: routedBaseline.evaluate,
			});
			expect(
				validateDedicatedCandidate({
					graph,
					ranks,
					measurements: entry.measurements,
					layout: selected.layout,
				}).valid,
			).toBe(true);
			expect(selected.witness.stop).not.toBe('baseline-fallback');
		}
	});

	it('admits incidents only after the assembled global geometry is validated', () => {
		const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'adjacent-3+1'));
		const created = createGraph(entry.document);
		if (!created.ok) throw new Error('Invalid incident admission graph');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		let admissions = 0;
		const selected = selectDedicatedRankLayout(graph, ranks, entry.measurements, {
			options: {},
			evaluate: evaluateDedicatedLayout,
			admit: () => {
				admissions += 1;
				return false;
			},
		});
		expect(admissions).toBe(1);
		expect(selected.layout).toEqual(
			evaluateDedicatedLayout(prepareLayout(graph, ranks), entry.measurements),
		);
		expect(selected.witness.work).toMatchObject({
			incidentAdmissions: 1,
			globalCompletePipelines: 2,
			globalValidations: 2,
		});
		expect(selected.witness.work.localCompletePipelines).toBeLessThanOrEqual(12);
		expect(selected.witness.stop).toBe('baseline-fallback');
		expect(
			validateRankOrder(
				collectRankOrderDomain(prepareLayout(graph, ranks)),
				selected.witness.selectedOrder,
			),
		).toBe(true);
	});

	it('counts analyzed route runs when a contacted baseline is rejected before selecting a valid order', () => {
		const document = validLogicDocument();
		const prepared = prepareLayoutDocument({
			...document,
			relations: document.relations.filter(({ id }) => id !== 'group-to-target'),
		});
		const { graph, ranks, measurements } = prepared;
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);
		const baseline = evaluateDedicatedLayout(structure, measurements, undefined, true);
		const first = defined(baseline.result.relations.find(({ id }) => id === 'a-to-choice'));
		const second = defined(baseline.result.relations.find(({ id }) => id === 'b-to-choice'));
		const shared = defined(first.points[2]);
		const port = defined(first.points.at(-1));
		const rejoined = [
			defined(second.points[0]),
			defined(second.points[1]),
			shared,
			{ x: shared.x, y: shared.y + 12 },
			{ x: shared.x + 28, y: shared.y + 12 },
			{ x: shared.x + 28, y: port.y - 6 },
			{ x: shared.x, y: port.y - 6 },
			port,
		];
		const rejected = {
			...baseline,
			result: {
				...baseline.result,
				relations: baseline.result.relations.map((route) => {
					if (route.id !== second.id) return route;
					return { ...route, points: rejoined };
				}),
			},
		};
		expect(
			validateDedicatedCandidate({ graph, ranks, measurements, layout: rejected.result }),
		).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.RouteContact });
		const result = searchDedicatedRankOrders({
			structure,
			domain,
			measurements,
			baseline: rejected,
			evaluate: (order) =>
				evaluateDedicatedLayout(
					applyRankOrder(structure, domain, order),
					measurements,
					undefined,
					true,
				),
			limits: { completePipelines: 12, uniqueProposals: 48 },
		});
		expect(result.selected?.order).toEqual([['source-b', 'source-a']]);
		expect(result.witness).toMatchObject({
			mode: 'exact',
			stop: 'complete',
			evaluated: 2,
			valid: 1,
			rejected: [{ reason: { code: DedicatedCandidateRejectionCode.RouteContact } }],
		});
		expect(result.witness.work.routeRunsInspected).toBe(
			routeCount(rejected.result) + routeCount(defined(result.selected).evaluation.result),
		);
	});
});

describe('rank-order heuristic cost and determinism', () => {
	it('bounds a 4-by-2 domain to 12 complete evaluations and 48 distinct proposals', () => {
		const document = corpusDocument(
			['a', 'b', 'c', 'f', 'd', 'e'],
			['a', 'b', 'c', 'f', 'd', 'e'],
			[
				{ id: 'a-d', from: 'a', to: 'd' },
				{ id: 'a-e', from: 'a', to: 'e' },
				{ id: 'b-d', from: 'b', to: 'd' },
				{ id: 'c-d', from: 'c', to: 'd' },
				{ id: 'f-d', from: 'f', to: 'd' },
			],
		);
		const created = createGraph(document);
		if (!created.ok) throw new Error('Invalid heuristic graph');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);
		const measurements = {
			nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 60 }])),
			groups: new Map(),
			junctions: new Map(),
		};
		expect(rankOrderEnumerationSize(domain)).toBe(48);
		const baseline = evaluateDedicatedLayout(structure, measurements, undefined, true);
		const damageAttachment = (evaluation: DedicatedLayoutEvaluation): DedicatedLayoutEvaluation => {
			const rejected = damageRouteAttachment(evaluation.result, ['a-d']);
			return { result: rejected, complete: () => rejected };
		};
		const noAdmissibleGeometry = searchDedicatedRankOrders({
			structure,
			domain,
			measurements,
			baseline: damageAttachment(baseline),
			evaluate: (order) =>
				damageAttachment(
					evaluateDedicatedLayout(
						applyRankOrder(structure, domain, order),
						measurements,
						undefined,
						true,
					),
				),
			limits: { completePipelines: 12, uniqueProposals: 48 },
		});
		expect(noAdmissibleGeometry.selected).toBeUndefined();
		expect(noAdmissibleGeometry.witness).toMatchObject({
			mode: 'heuristic',
			stop: 'baseline-fallback',
			valid: 0,
		});
		expect(noAdmissibleGeometry.witness.rejected).toHaveLength(
			noAdmissibleGeometry.witness.evaluated,
		);
		const budget = searchDedicatedRankOrders({
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
			limits: { completePipelines: 12, uniqueProposals: 2 },
		});
		expect(budget.witness).toMatchObject({
			mode: 'heuristic',
			stop: 'proposal-budget',
			proposed: 2,
			exhaustive: false,
			truncated: true,
		});
		const first = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
		const second = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
		expect(second).toEqual(first);
		expect(first.witness.mode).toBe('heuristic');
		expect(first.witness.evaluated).toBeLessThanOrEqual(12);
		expect(first.witness.proposed).toBeLessThanOrEqual(48);
		expect(
			validateDedicatedCandidate({ graph, ranks, measurements, layout: first.layout }).valid,
		).toBe(true);
	});
});

describe('rank-order cold-layout convergence', () => {
	it('is independent of endpoint and relation array permutations in four directions, including inspection', () => {
		const entries = [rankOrderComparisonCorpus()[0], rankOrderComparisonCorpus()[1]];
		const directions = [
			LayoutDirection.TopToBottom,
			LayoutDirection.BottomToTop,
			LayoutDirection.LeftToRight,
			LayoutDirection.RightToLeft,
		];
		for (const entry of entries) {
			if (entry === undefined) throw new Error('Missing corpus entry');
			for (const direction of directions) {
				let bias = LayoutBias.Top;
				if (direction === LayoutDirection.BottomToTop) bias = LayoutBias.Bottom;
				if (direction === LayoutDirection.LeftToRight) bias = LayoutBias.Left;
				if (direction === LayoutDirection.RightToLeft) bias = LayoutBias.Right;
				const configuration = layoutConfiguration(direction, bias);
				if (configuration === undefined) throw new Error('Invalid direction');
				const documentary = { ...entry.document, layout: configuration };
				const permuted = {
					...documentary,
					nodes: [...documentary.nodes].reverse(),
					relations: [...documentary.relations].reverse(),
					groups: [...documentary.groups].reverse(),
				};
				const original = createGraph(documentary);
				const reversed = createGraph(permuted);
				if (!original.ok || !reversed.ok) throw new Error('Invalid permuted corpus');
				for (const inspectRouting of [false, true]) {
					const first = layoutWithDedicatedEngineAndRankOrderWitness(
						original.value,
						topologicallyRank(original.value),
						entry.measurements,
						{ inspectRouting },
					);
					const second = layoutWithDedicatedEngineAndRankOrderWitness(
						reversed.value,
						topologicallyRank(reversed.value),
						entry.measurements,
						{ inspectRouting },
					);
					expect(second).toEqual(first);
				}
			}
		}
	});
});

describe('collaborative rank-order convergence', () => {
	it('chooses identical cold geometry after concurrent relations merge in opposite orders', () => {
		const entry = rankOrderComparisonCorpus()[0];
		if (entry === undefined) throw new Error('Missing exact rank-search fixture');
		const base = new Y.Doc();
		importLogicDocument(base, entry.document);
		const first = new Y.Doc();
		const second = new Y.Doc();
		Y.applyUpdate(first, Y.encodeStateAsUpdate(base));
		Y.applyUpdate(second, Y.encodeStateAsUpdate(base));
		first
			.getMap<Y.Map<unknown>>('sequit.relations')
			.set('b-to-e', createYjsEntityMap({ from: 'b', to: 'e' }));
		second
			.getMap<Y.Map<unknown>>('sequit.relations')
			.set('c-to-e', createYjsEntityMap({ from: 'c', to: 'e' }));
		const left = new Y.Doc();
		const right = new Y.Doc();
		for (const target of [left, right]) Y.applyUpdate(target, Y.encodeStateAsUpdate(base));
		Y.applyUpdate(left, Y.encodeStateAsUpdate(first));
		Y.applyUpdate(left, Y.encodeStateAsUpdate(second));
		Y.applyUpdate(right, Y.encodeStateAsUpdate(second));
		Y.applyUpdate(right, Y.encodeStateAsUpdate(first));
		const leftDocument = readLogicDocument(left);
		const rightDocument = readLogicDocument(right);
		if (!leftDocument.ok || !rightDocument.ok) throw new Error('Merged document must be valid');
		expect(leftDocument.value).toEqual(rightDocument.value);
		const leftGraph = createGraph(leftDocument.value);
		const rightGraph = createGraph(rightDocument.value);
		if (!leftGraph.ok || !rightGraph.ok) throw new Error('Merged graphs must be valid');
		const firstLayout = layoutWithDedicatedEngineAndRankOrderWitness(
			leftGraph.value,
			topologicallyRank(leftGraph.value),
			entry.measurements,
		);
		const secondLayout = layoutWithDedicatedEngineAndRankOrderWitness(
			rightGraph.value,
			topologicallyRank(rightGraph.value),
			entry.measurements,
		);
		expect(firstLayout).toEqual(secondLayout);
		expect(firstLayout.witness.mode).toBe('exact');
	});
});

it('keeps a grouped member with no incident relation at documentary position', () => {
	const base = corpusDocument(
		['a', 'b', 'c'],
		['a', 'b', 'c'],
		[
			{ id: 'g-c', from: 'g', to: 'c' },
			{ id: 'a-c', from: 'a', to: 'c' },
		],
	);
	const document = {
		...base,
		groups: [
			{ kind: EndpointKind.Group as const, id: 'g', label: 'Group', layoutOrder: orderKey('a0') },
		],
		nodes: base.nodes.map((node) => {
			if (node.id === 'c') return node;
			return { ...node, groupId: 'g' };
		}),
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid grouped graph');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	const measurements = {
		nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 40 }])),
		groups: new Map([
			['g', { minimumWidth: 100, minimumHeight: 60, headerHeight: 20, padding: 8 }],
		]),
		junctions: new Map(),
	};
	expect(
		validateDedicatedCandidate({
			graph,
			ranks,
			measurements,
			layout: evaluateDedicatedLayout(structure, measurements),
		}).valid,
	).toBe(true);
	expect(domain.bands).toEqual([['a', 'b']]);
	expect(barycentricSweep({ structure, domain }, domain.bands, false)).toEqual(domain.bands);
});

it('searches projected group routes through the component of their target', () => {
	const base = corpusDocument(
		['a', 'b', 'd', 'e'],
		['a', 'b', 'd', 'e'],
		[
			{ id: 'g-d', from: 'g', to: 'd' },
			{ id: 'a-e', from: 'a', to: 'e' },
		],
	);
	const document = {
		...base,
		layout: defined(layoutConfiguration(LayoutDirection.LeftToRight, LayoutBias.Left)),
		groups: [
			{ kind: EndpointKind.Group as const, id: 'g', label: 'Group', layoutOrder: orderKey('a0') },
		],
		nodes: base.nodes.map((node) => {
			if (node.id === 'a' || node.id === 'b') return { ...node, groupId: 'g' };
			return node;
		}),
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid grouped target fixture');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	const relevant = new Set(
		domain.locations.flatMap(
			({ componentIndex }) => defined(structure.components[componentIndex]).ids,
		),
	);
	expect(relevant.has('g')).toBe(false);
	expect(relevant.has('d')).toBe(true);
	const measurements = {
		nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 60 }])),
		groups: new Map([
			['g', { minimumWidth: 100, minimumHeight: 60, headerHeight: 20, padding: 8 }],
		]),
		junctions: new Map(),
	};
	const baseline = evaluateDedicatedLayout(structure, measurements);
	const validated = validateDedicatedCandidate({ graph, ranks, measurements, layout: baseline });
	if (!validated.valid) throw new Error('Group route baseline must be valid');
	expect(validated.analysis.crossings).toContainEqual(
		expect.objectContaining({ horizontalId: 'g-d', verticalId: 'a-e' }),
	);
	const result = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements);
	expect(result.witness.mode).toBe('exact');
	expect(result.witness.evaluated).toBeGreaterThan(1);
	expect(
		validateDedicatedCandidate({ graph, ranks, measurements, layout: result.layout }).valid,
	).toBe(true);
});

it('leaves a permutable component unchanged when all strict crossings belong to a fixed chain', () => {
	const ids = ['u', 'v', 'w', 'z', 'a', 'b', 'c'];
	const relations: LogicRelation[] = [
		{ id: 'a-c', from: 'a', to: 'c' },
		{ id: 'b-c', from: 'b', to: 'c' },
		{ id: 'u-v', from: 'u', to: 'v' },
		{ id: 'v-w', from: 'v', to: 'w' },
		{ id: 'w-z', from: 'w', to: 'z' },
		{ id: 'u-w', from: 'u', to: 'w' },
		{ id: 'v-z', from: 'v', to: 'z' },
	];
	for (const direction of [
		LayoutDirection.TopToBottom,
		LayoutDirection.BottomToTop,
		LayoutDirection.LeftToRight,
		LayoutDirection.RightToLeft,
	]) {
		let bias = LayoutBias.Top;
		if (direction === LayoutDirection.BottomToTop) bias = LayoutBias.Bottom;
		if (direction === LayoutDirection.LeftToRight) bias = LayoutBias.Left;
		if (direction === LayoutDirection.RightToLeft) bias = LayoutBias.Right;
		const document = {
			...corpusDocument(ids, ids, relations),
			layout: defined(layoutConfiguration(direction, bias)),
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('Invalid disconnected crossing fixture');
		const graph = created.value;
		const ranks = topologicallyRank(graph);
		const structure = prepareLayout(graph, ranks);
		const domain = collectRankOrderDomain(structure);
		expect(domain.bands).toEqual([['a', 'b']]);
		const measurements = {
			nodes: new Map(document.nodes.map(({ id }) => [id, { width: 80, height: 60 }])),
			groups: new Map(),
			junctions: new Map(),
		};
		const options = { inspectRouting: true };
		const baseline = evaluateDedicatedLayout(structure, measurements, options);
		const validated = validateDedicatedCandidate({ graph, ranks, measurements, layout: baseline });
		if (!validated.valid) throw new Error('Fixed crossing must be geometrically valid');
		expect(validated.analysis.crossings.length).toBeGreaterThan(0);
		expect(
			validated.analysis.crossings.every(({ horizontalId, verticalId }) =>
				[horizontalId, verticalId].every(
					(id) => id.startsWith('u-') || id.startsWith('v-') || id.startsWith('w-'),
				),
			),
		).toBe(true);
		const selected = layoutWithDedicatedEngineAndRankOrderWitness(
			graph,
			ranks,
			measurements,
			options,
		);
		expect(selected.layout).toEqual(baseline);
		expect(selected.witness).toMatchObject({
			mode: 'skipped',
			stop: 'optimal-bound',
			evaluated: 1,
			valid: 1,
			exhaustive: true,
			truncated: false,
		});
	}
});
