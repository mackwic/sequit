import fc from 'fast-check';
import { expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
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
