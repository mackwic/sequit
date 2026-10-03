import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	LAYOUT_DIRECTIONS,
	layoutConfiguration,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { layoutWithRootRegion } from '../../../../src/lib/core/layout/root-region';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import {
	assertLayoutEquivalent,
	type LayoutCandidate,
} from '../../../support/harnesses/layout-differential';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';

function reversedCollections(document: LogicDocument): LogicDocument {
	return {
		...document,
		natures: [...document.natures].reverse(),
		groups: [...document.groups].reverse(),
		nodes: [...document.nodes].reverse(),
		junctions: [...document.junctions].reverse(),
		relations: [...document.relations].reverse(),
	};
}

const candidate: LayoutCandidate = ({ graph, ranks, measurements }, options) =>
	layoutWithRootRegion(graph, ranks, measurements, options);

describe('layout differential harness', () => {
	it('matches the root-region engine across generated single-region documents', async () => {
		await fc.assert(
			fc.asyncProperty(
				richAcyclicLogicDocumentArbitrary({ minNodes: 3, maxNodes: 9 }),
				async (document) => {
					await assertLayoutEquivalent({ document, label: 'generated single region' }, candidate);
				},
			),
			PROPERTY_PARAMETERS,
		);
		// User decision 2026-10-02 (correction before performance): the timeout is measured, not guessed.
		// Alone on this test, three runs under coverage (the `test:coverage:web:fast` flags) took
		// 61.5, 82.1 (machine load about 13) and 58.9 s, three runs without coverage 27.3, 26.0 and
		// 26.8 s; the timeout is ceil(82.1 x 1.5 / 5) x 5 = 125 s. The integration branch alone takes
		// 14.2 s (30.9 s under coverage). The slowdown comes from the raw merge 679ab190: the
		// rank-order candidates that the merged placement leaves invalid (group-passage,
		// element-overlap) each cost a full group-route repair (repairRoute -> boundaryOnTrack).
		// Attribution and profiles: merge report, section "Suite AttributeMergeSlowdown".
	}, 125_000);

	it.each(LAYOUT_DIRECTIONS)(
		'matches the root-region engine across permutations in %s',
		async (direction) => {
			const source = validLogicDocument();
			const document: LogicDocument = {
				...source,
				layout: defined(layoutConfiguration(direction, defaultBiasFor(direction))),
			};
			const measurements = {
				nodes: { 'source-a': { width: 123.5, height: 73.25 } },
				junctions: { choice: { width: 29.5, height: 21.25 } },
				groups: {
					container: {
						minimumWidth: 160.5,
						minimumHeight: 72.25,
						headerHeight: 36.5,
						padding: 24.25,
					},
				},
			};
			const baseline = await assertLayoutEquivalent(
				{
					document,
					measurements,
					options: { inspectRouting: true },
					label: 'original collections',
				},
				candidate,
			);
			const permuted = await assertLayoutEquivalent(
				{
					document: reversedCollections(document),
					measurements,
					options: { inspectRouting: true },
					label: 'reversed collections',
				},
				candidate,
			);
			expect(permuted).toEqual(baseline);
		},
	);

	it('reports the case and direction when a candidate changes observable geometry', async () => {
		const document = validLogicDocument();
		await expect(
			assertLayoutEquivalent({ document, label: 'changed width' }, async (input, options) => {
				const result = await candidate(input, options);
				return { ...result, width: result.width + 0.25 };
			}),
		).rejects.toThrow(
			/Layout mismatch for changed width \(document valid-document, direction bottom-to-top.*\): width \(/,
		);
	});
});
