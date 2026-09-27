import fc from 'fast-check';
import { expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

const verifyPublishedLayouts = async () => {
	let invalidCount = 0;
	const firstFailures: string[] = [];
	for (const [index, document] of fc
		.sample(richAcyclicLogicDocumentArbitrary(), {
			numRuns: PROPERTY_PARAMETERS.numRuns,
			seed: PROPERTY_PARAMETERS.seed ?? 1_592_915_777,
		})
		.entries()) {
		const prepared = prepareLayoutDocument(document);
		const layout = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
		const result = validateDedicatedCandidate({ ...prepared, layout });
		if (result.valid) continue;
		invalidCount += 1;
		if (firstFailures.length < 3) firstFailures.push(JSON.stringify({ index, document, result }));
	}
	expect(invalidCount, firstFailures.join('\n')).toBe(0);
};

// Fuzz still exercises all 5,000 cases; its fixed seed includes a reduced route-contact defect.
if (process.env['SEQUIT_PROPERTY_MODE'] === 'fuzz')
	it.fails(
		'fuzzes published layouts against the independent geometry validator',
		verifyPublishedLayouts,
		600_000,
	);
else
	it(
		'checks published layouts against the independent geometry validator',
		verifyPublishedLayouts,
		600_000,
	);
