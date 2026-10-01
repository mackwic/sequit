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
	type LayoutResult,
	RelationBoundsOverlap,
} from '../../../../src/lib/core/layout/layout-types';
import type { DedicatedLayoutEvaluator } from '../../../../src/lib/core/layout/rank/rank-order-search';
import { selectDedicatedRankLayout } from '../../../../src/lib/core/layout/rank/rank-order-selection';
import { collectRankOrderDomain } from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
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

const biasByDirection: Record<LayoutDirection, LayoutBias> = {
	[LayoutDirection.TopToBottom]: LayoutBias.Top,
	[LayoutDirection.BottomToTop]: LayoutBias.Bottom,
	[LayoutDirection.LeftToRight]: LayoutBias.Left,
	[LayoutDirection.RightToLeft]: LayoutBias.Right,
};

// M2-01: A = j0 -> {n3, n4, n7}, n3 -> n7 beside B = n6 -> {n5, x}; each is valid alone.
function interferingComponents(direction: LayoutDirection): LogicDocument {
	return {
		...validLogicDocument(),
		layout: defined(layoutConfiguration(direction, biasByDirection[direction])),
		groups: [],
		nodes: ['n3', 'n4', 'n5', 'n6', 'n7', 'x'].map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			layoutOrder: orderKey(`a${index + 1}`),
			natureId: 'goal',
			markdown: id,
		})),
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'j0',
				layoutOrder: orderKey('a7'),
				operator: JunctionOperator.Xor,
			},
		],
		relations: [
			{ id: 'j0-n3', from: 'j0', to: 'n3' },
			{ id: 'j0-n4', from: 'j0', to: 'n4' },
			{ id: 'j0-n7', from: 'j0', to: 'n7' },
			{ id: 'n3-n7', from: 'n3', to: 'n7' },
			{ id: 'n6-n5', from: 'n6', to: 'n5' },
			{ id: 'n6-x', from: 'n6', to: 'x' },
		],
	};
}

it('validates the assembly of separately searched components before publishing it', async () => {
	for (const direction of Object.values(LayoutDirection)) {
		const prepared = prepareLayoutDocument(interferingComponents(direction));
		const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
		const validation = validateDedicatedCandidate({ ...prepared, layout });
		expect(validation, `${direction}: ${JSON.stringify(validation)}`).toMatchObject({
			valid: true,
		});
		const { witness } = layoutWithDedicatedEngineAndRankOrderWitness(
			prepared.graph,
			prepared.ranks,
			prepared.measurements,
		);
		expect(witness.components, direction).toHaveLength(2);
		expect(witness, direction).toMatchObject({
			unverified: 0,
			finalValidation: { valid: true },
			work: { globalValidations: 1 },
		});
	}
});

/** Two copies of a two-successor fork: each local search keeps its documentary order. */
function twinForks() {
	const entry = defined(rankOrderComparisonCorpus().find(({ id }) => id === 'two-successors'));
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
	expect(selected.witness.valid + selected.witness.rejected.length).toBe(
		selected.witness.evaluated,
	);
});
