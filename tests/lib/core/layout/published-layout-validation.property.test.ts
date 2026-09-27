import fc from 'fast-check';
import { expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

it('fuzzes published layouts against the independent geometry validator', async () => {
	await fc.assert(
		fc.asyncProperty(richAcyclicLogicDocumentArbitrary(), async (document) => {
			const prepared = prepareLayoutDocument(document);
			const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
			const result = validateDedicatedCandidate({ ...prepared, layout });
			expect(result, JSON.stringify(result)).toMatchObject({ valid: true });
		}),
		PROPERTY_PARAMETERS,
	);
}, 600_000);
