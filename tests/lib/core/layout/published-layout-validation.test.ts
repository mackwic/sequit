import fc from 'fast-check';
import { expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
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
