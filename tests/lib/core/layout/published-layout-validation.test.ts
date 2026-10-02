import fc from 'fast-check';
import { expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { DedicatedCandidateRejectionCode } from '../../../../src/lib/core/layout/dedicated-candidate-validation/types';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngineAndRankOrderWitness,
} from '../../../../src/lib/core/layout/layout-engine';
import {
	type DedicatedLayoutEvaluation,
	GroupRouteFailure,
	type LayoutResult,
	RelationBoundsOverlap,
} from '../../../../src/lib/core/layout/layout-types';
import type { DedicatedLayoutEvaluator } from '../../../../src/lib/core/layout/rank/rank-order-search';
import { selectDedicatedRankLayout } from '../../../../src/lib/core/layout/rank/rank-order-selection';
import type { RankOrderSearchWitness } from '../../../../src/lib/core/layout/rank/rank-order-witness';
import { collectRankOrderDomain } from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { junctionObstacle } from '../../../support/fixtures/routing-obstacles';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

it('publishes only independently valid layouts for rich acyclic documents', async () => {
	for (const [index, document] of fc
		.sample(richAcyclicLogicDocumentArbitrary(), { seed: 1_592_915_777, numRuns: 50 })
		.entries()) {
		const prepared = prepareLayoutDocument(document);
		const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
		const result = validateDedicatedCandidate({ ...prepared, layout });
		expect(
			result,
			`sample ${index}: ${JSON.stringify(result)}; document ${JSON.stringify(document)}`,
		).toMatchObject({ valid: true });
	}
}, 120_000);

it.each(Object.values(LayoutDirection))(
	'validates shared group/member targets (%s)',
	async (direction) => {
		for (const withJunction of [true, false]) {
			let edges = [
				['n0', 'g0'],
				['n2', 'n1'],
				['n0', 'n1'],
				['n3', 'g0'],
				['n0', 'n2'],
				['n3', 'n1'],
			];
			let nodeCount = 4;
			let memberIndex = 1;
			const junctions: LogicDocument['junctions'][number][] = [];
			if (withJunction) {
				edges = [
					['n1', 'j0'],
					['n0', 'n1'],
					['n0', 'n2'],
					['j0', 'n2'],
					['g0', 'n2'],
				];
				nodeCount = 3;
				memberIndex = 0;
				junctions.push({
					kind: EndpointKind.Junction,
					id: 'j0',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a0'),
				});
			}
			const document: LogicDocument = {
				...validLogicDocument(),
				layout: defined(
					layoutConfiguration(direction, LayoutBias.Top) ??
						layoutConfiguration(direction, LayoutBias.Left),
				),
				groups: [
					{ kind: EndpointKind.Group, id: 'g0', label: 'Group', layoutOrder: orderKey('a0') },
				],
				nodes: Array.from({ length: nodeCount }, (_, index) => {
					const node = {
						kind: EndpointKind.Node,
						id: `n${index}`,
						markdown: '',
						natureId: 'goal',
						layoutOrder: orderKey(`a${index}`),
					} as const;
					if (index === memberIndex) return { ...node, groupId: 'g0' };
					return node;
				}),
				junctions,
				relations: edges.map(([from, to], index) => ({
					id: `r${index}-${from}-${to}`,
					from: defined(from),
					to: defined(to),
				})),
			};
			const prepared = prepareLayoutDocument(document);
			const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
			const validation = validateDedicatedCandidate({ ...prepared, layout });
			expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
		}
	},
);

const GENERATED_GROUPS: LogicDocument['groups'] = [
	{
		kind: EndpointKind.Group,
		id: 'group-00',
		label: 'Root group',
		layoutOrder: orderKey('aH00001'),
	},
	{
		kind: EndpointKind.Group,
		id: 'group-01',
		label: 'Nested group 1',
		groupId: 'group-00',
		layoutOrder: orderKey('aH00011'),
	},
	{
		kind: EndpointKind.Group,
		id: 'group-02',
		label: 'Empty endpoint group',
		layoutOrder: orderKey('aG00021'),
	},
	{
		kind: EndpointKind.Group,
		id: 'group-03',
		label: 'Empty group root',
		layoutOrder: orderKey('aG00031'),
	},
	{
		kind: EndpointKind.Group,
		id: 'empty-group-00',
		label: 'Nested empty group 1',
		groupId: 'group-03',
		layoutOrder: orderKey('aE00001'),
	},
];

// Reduced from the expanded generator; junctions are members of `group-00`.
it.each(
	Object.values(LayoutDirection).flatMap((direction) => [
		{
			// Two outgoing central ports diverged after repair.
			name: 'keeps a shared junction stem beside nested frames',
			direction,
			nodeGroups: [
				'group-00',
				undefined,
				'group-01',
				undefined,
				'group-00',
				'group-00',
				'group-00',
				'group-00',
				'group-00',
				'group-01',
			],
			junctions: 3,
			edges: [
				['node-00', 'junction-00'],
				['junction-00', 'group-02'],
				['junction-00', 'node-09'],
				['group-02', 'node-01'],
				['group-00', 'node-01'],
			],
		},
		{
			// The last repaired route took the bridge carrier of a crossing between two others.
			name: 'keeps the bridges of crossings between other repaired routes',
			direction,
			nodeGroups: ['group-00', 'group-00', 'group-01'],
			junctions: 2,
			edges: [
				['node-00', 'group-02'],
				['node-00', 'junction-00'],
				['junction-00', 'group-02'],
				['group-02', 'group-03'],
				['group-02', 'node-01'],
				['empty-group-00', 'group-01'],
				['empty-group-00', 'junction-01'],
				['node-02', 'junction-01'],
			],
		},
	]),
)('$name ($direction)', async ({ direction, nodeGroups, junctions, edges }) => {
	const padded = (index: number): string => index.toString().padStart(2, '0');
	const document: LogicDocument = {
		...validLogicDocument(),
		layout: defined(
			layoutConfiguration(direction, LayoutBias.Top) ??
				layoutConfiguration(direction, LayoutBias.Left),
		),
		groups: GENERATED_GROUPS,
		nodes: nodeGroups.map((groupId, index) => {
			const node = {
				kind: EndpointKind.Node,
				id: `node-${padded(index)}`,
				natureId: 'goal',
				markdown: '',
				layoutOrder: orderKey(`aN${index.toString().padStart(4, '0')}1`),
			} as const;
			if (groupId === undefined) return node;
			return { ...node, groupId };
		}),
		junctions: Array.from({ length: junctions }, (_, index) => ({
			kind: EndpointKind.Junction,
			id: `junction-${padded(index)}`,
			groupId: 'group-00',
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(`aJ${index.toString().padStart(4, '0')}1`),
		})),
		relations: edges.map(([from, to], index) => ({
			id: `relation-${index.toString().padStart(3, '0')}`,
			from: defined(from),
			to: defined(to),
		})),
	};
	const prepared = prepareLayoutDocument(document);
	const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
	const validation = validateDedicatedCandidate({ ...prepared, layout });
	expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
});

// D-07 corpus G2, seed 629: in bottom-to-top, n2→j1 needs the junction column that the pending
// g0 routes reserve below their port; it succeeds once they have moved during their own repair.
it.each(Object.values(LayoutDirection))(
	'retries a route blocked by a pending group attachment (%s)',
	async (direction) => {
		const members: Readonly<Record<string, string>> = { n2: 'g0', j0: 'g0' };
		const endpoint = (id: string) => {
			const groupId = members[id];
			if (groupId === undefined) return { id };
			return { id, groupId };
		};
		let order = 0;
		const key = () => orderKey(`a${(order++).toString().padStart(3, '0')}1`);
		const groups = ['g0', 'g1'].map((id): LogicDocument['groups'][number] => ({
			kind: EndpointKind.Group,
			label: id,
			layoutOrder: key(),
			...endpoint(id),
		}));
		const nodes = ['n0', 'n1', 'n2'].map((id): LogicDocument['nodes'][number] => ({
			kind: EndpointKind.Node,
			natureId: 'goal',
			markdown: id,
			layoutOrder: key(),
			...endpoint(id),
		}));
		const junctions = ['j0', 'j1'].map((id): LogicDocument['junctions'][number] => ({
			kind: EndpointKind.Junction,
			operator: JunctionOperator.Xor,
			layoutOrder: key(),
			...endpoint(id),
		}));
		const document: LogicDocument = {
			...validLogicDocument(),
			layout: defined(
				layoutConfiguration(direction, LayoutBias.Top) ??
					layoutConfiguration(direction, LayoutBias.Left),
			),
			groups,
			nodes,
			junctions,
			relations: [
				['g0', 'g1'],
				['j0', 'n1'],
				['n1', 'g1'],
				['n2', 'n0'],
				['n2', 'j1'],
				['g0', 'n0'],
				['j0', 'g1'],
			].map(([from, to], index) => ({ id: `r${index}`, from: defined(from), to: defined(to) })),
		};
		const prepared = prepareLayoutDocument(document);
		const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
		const validation = validateDedicatedCandidate({ ...prepared, layout });
		expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
	},
);

// Reduced from 11 nodes, five groups and six routes: junction→node-01 touches node-04→node-10.
it('publishes only validated routes beside an independent junction-group branch', async () => {
	const document: LogicDocument = {
		...validLogicDocument(),
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top } as const,
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'group-02',
				label: 'Empty endpoint',
				layoutOrder: 'aG00021',
			},
		],
		junctions: [
			{
				kind: EndpointKind.Junction as const,
				id: 'junction-00',
				layoutOrder: 'aJ00001',
				operator: JunctionOperator.Xor,
			},
			{
				kind: EndpointKind.Junction as const,
				id: 'junction-01',
				layoutOrder: 'aJ00011',
				operator: JunctionOperator.Xor,
			},
		],
		nodes: ['01', '04', '10'].map((suffix) => ({
			kind: EndpointKind.Node as const,
			id: `node-${suffix}`,
			natureId: 'goal',
			markdown: '',
			layoutOrder: `aN00${suffix}1`,
		})),
		relations: [
			{ id: 'relation-001', from: 'junction-00', to: 'group-02' },
			{ id: 'relation-002', from: 'junction-00', to: 'node-01' },
			{ id: 'relation-003', from: 'group-02', to: 'node-01' },
			{ id: 'relation-004', from: 'node-04', to: 'node-10' },
		],
	};
	const prepared = prepareLayoutDocument(document);
	const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
	const validation = validateDedicatedCandidate({ ...prepared, layout });
	expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
});

/** Every evaluated order is counted once: valid, rejected, or published unverified. */
function expectCountedOnce(witness: RankOrderSearchWitness): void {
	expect(witness.valid + witness.rejected.length + witness.unverified).toBe(witness.evaluated);
}

/**
 * Two disconnected copies of a corpus entry. Each local search keeps the documentary order of
 * `two-successors` and reorders `geometric-2+2`.
 */
function twinForks(corpusId = 'two-successors') {
	const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === corpusId));
	const document: LogicDocument = {
		...entry.document,
		nodes: [
			...entry.document.nodes,
			...entry.document.nodes.map((node) => ({ ...node, id: `x-${node.id}` })),
		],
		relations: [
			...entry.document.relations,
			...entry.document.relations.map((relation) => ({
				id: `x-${relation.id}`,
				from: `x-${relation.from}`,
				to: `x-${relation.to}`,
			})),
		],
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid twin forks');
	const measurements = {
		...entry.measurements,
		nodes: new Map([
			...entry.measurements.nodes,
			...[...entry.measurements.nodes].map(([id, size]) => [`x-${id}`, size] as const),
		]),
	};
	return { graph: created.value, ranks: topologicallyRank(created.value), measurements };
}

/** Damage complete documents the predicate selects, numbered from 1 in evaluation order. */
function damagingEvaluator(
	graph: ReturnType<typeof twinForks>['graph'],
	damaged: (pipeline: number) => boolean,
): DedicatedLayoutEvaluator {
	let pipelines = 0;
	return (structure, measurements, options): DedicatedLayoutEvaluation => {
		const actual = evaluateDedicatedLayout(structure, measurements, options, true);
		if (structure.graph !== graph) return actual;
		pipelines += 1;
		if (!damaged(pipelines)) return actual;
		const result: LayoutResult = { ...actual.result, relations: [] };
		return { result, complete: () => result };
	};
}

it('replaces a rejected documentary assembly by an order validated on the whole document', () => {
	const { graph, ranks, measurements } = twinForks();
	const selected = selectDedicatedRankLayout(graph, ranks, measurements, {
		options: {},
		evaluate: damagingEvaluator(graph, (pipeline) => pipeline === 1),
	});
	expect(
		validateDedicatedCandidate({ graph, ranks, measurements, layout: selected.layout }),
	).toMatchObject({ valid: true });
	const { witness } = selected;
	const documentary = collectRankOrderDomain(prepareLayout(graph, ranks)).bands;
	expect(witness.components).toHaveLength(2);
	expect(witness.rejected).toContainEqual({
		order: documentary,
		reason: { valid: false, code: DedicatedCandidateRejectionCode.RelationInventory },
	});
	expect(witness.selectedOrder).not.toEqual(documentary);
	expect(witness.finalValidation).toEqual({ valid: true });
	expect(witness.work.globalCompletePipelines).toBeGreaterThan(1);
	expect(witness.work.globalValidations).toBeGreaterThan(1);
	expectCountedOnce(witness);
});

it('witnesses the rejection when no order of the whole document passes validation', () => {
	const { graph, ranks, measurements } = twinForks();
	const selected = selectDedicatedRankLayout(graph, ranks, measurements, {
		options: {},
		evaluate: damagingEvaluator(graph, () => true),
	});
	expect(selected.witness.finalValidation).toEqual({
		valid: false,
		code: DedicatedCandidateRejectionCode.RelationInventory,
	});
	expect(selected.witness.unverified).toBe(1);
	expect(selected.witness.work.globalCompletePipelines).toBeGreaterThan(1);
	// The published documentary order is unverified, no longer among the rejected orders.
	expect(selected.witness.rejected.map(({ reason }) => reason)).not.toContain(
		selected.witness.finalValidation,
	);
	expectCountedOnce(selected.witness);
});

it('rejects with a typed reason a candidate whose relation endpoints overlap', () => {
	const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'geometric-2+2'));
	const created = createGraph(entry.document);
	if (!created.ok) throw new Error('Invalid geometric order witness');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	let pipelines = 0;
	const selected = selectDedicatedRankLayout(graph, ranks, entry.measurements, {
		options: {},
		evaluate: (structure, measurements, options) => {
			pipelines += 1;
			if (pipelines > 1) throw new RelationBoundsOverlap('a-d', 'a', 'd');
			return evaluateDedicatedLayout(structure, measurements, options, true);
		},
	});
	expect(selected.layout).toEqual(
		evaluateDedicatedLayout(prepareLayout(graph, ranks), entry.measurements),
	);
	expect(selected.witness.rejected.length).toBeGreaterThan(0);
	for (const { reason } of selected.witness.rejected)
		expect(reason).toEqual({
			valid: false,
			code: DedicatedCandidateRejectionCode.ElementOverlap,
			endpointId: 'a',
			otherEndpointId: 'd',
			relationId: 'a-d',
		});
	expectCountedOnce(selected.witness);
});

// Witness of the open junction-port point: with these sizes, every order of this single
// component is rejected (ports at j), so the documentary layout stays published.
it('counts a rejected published layout once, as unverified, after a whole-document search', () => {
	const fixture = junctionObstacle(LayoutDirection.LeftToRight, {
		nodes: {
			p: { width: 80, height: 177 },
			q: { width: 278, height: 54 },
			s: { width: 97, height: 91 },
			u: { width: 279, height: 176 },
			v: { width: 83, height: 176 },
			w: { width: 87, height: 127 },
			g: { width: 236, height: 40 },
			x: { width: 276, height: 43 },
		},
		junction: { width: 56, height: 14 },
	});
	const junctions = fixture.junctions ?? {};
	const ids = [...Object.keys(fixture.nodes), ...Object.keys(junctions)];
	const order = (id: string) => orderKey(`a${ids.indexOf(id).toString().padStart(2, '0')}1`);
	const created = createGraph({
		...validLogicDocument(),
		layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		groups: [],
		nodes: Object.keys(fixture.nodes).map((id) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: order(id),
		})),
		junctions: Object.keys(junctions).map((id) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: order(id),
		})),
		relations: fixture.relations,
	});
	if (!created.ok) throw new Error('Invalid junction-port witness');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const measurements = {
		nodes: new Map(Object.entries(fixture.nodes)),
		groups: new Map(),
		junctions: new Map(Object.entries(junctions)),
	};
	const { layout, witness } = layoutWithDedicatedEngineAndRankOrderWitness(
		graph,
		ranks,
		measurements,
	);
	const verdict = validateDedicatedCandidate({ graph, ranks, measurements, layout });
	expect(verdict).toMatchObject({ valid: false, code: DedicatedCandidateRejectionCode.Ports });
	expect(witness.finalValidation).toEqual(verdict);
	expect(witness.unverified).toBe(1);
	expect(witness.valid).toBe(0);
	// The local search over the whole document already judged it: no global validation again.
	expect(witness.work.globalValidations).toBe(0);
	expectCountedOnce(witness);
});

it('validates the published geometry, never a discarded trial, and counts real validations', () => {
	const { graph, ranks, measurements } = twinForks('geometric-2+2');
	let globalPipelines = 0;
	const selected = selectDedicatedRankLayout(graph, ranks, measurements, {
		options: {},
		evaluate: (structure, sizes, options) => {
			if (structure.graph === graph) globalPipelines += 1;
			// Every reordered assembly fails before routing; the documentary one routes.
			if (structure.graph === graph && globalPipelines > 1) throw new GroupRouteFailure('a-d');
			return evaluateDedicatedLayout(structure, sizes, options, true);
		},
	});
	expect(selected.layout).toEqual(
		evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements),
	);
	expect(
		validateDedicatedCandidate({ graph, ranks, measurements, layout: selected.layout }).valid,
	).toBe(true);
	expect(selected.witness.fallbackComponents).toHaveLength(2);
	expect(selected.witness.finalValidation).toEqual({ valid: true });
	expect(selected.witness.unverified).toBe(0);
	// Two trials failed to build and were never validated: only the documentary one was.
	expect(selected.witness.work.globalCompletePipelines).toBe(3);
	expect(selected.witness.work.globalValidations).toBe(1);
});
