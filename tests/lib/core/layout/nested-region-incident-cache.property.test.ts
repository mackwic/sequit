import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { solveNestedRegionLayoutForProjection } from '../../../../src/lib/core/layout/nested-region-layout';
import { RegionCompositionStatus } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { validateNestedRegionGeometry } from '../../../../src/lib/core/layout/regions/validation/nested-region-geometry';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

const edit = fc.record({
	mode: fc.constantFrom('local', 'incoming', 'outgoing', 'both'),
	suffix: fc.integer({ min: 0, max: 20 }),
	permuted: fc.boolean(),
});

describe('recursive incident contract cache', () => {
	it('matches cold composition after short incident edit sequences', () => {
		fc.assert(
			fc.property(fc.array(edit, { minLength: 1, maxLength: 4 }), (edits) => {
				const cache = new RegionLocalLayoutCache();
				const source = depthTwoRegionDocument();
				const input = depthTwoRegionInput();
				for (const change of edits) {
					const local = defined(source.relations.find(({ id }) => id === 'inside-a'));
					const incoming = defined(source.relations.find(({ id }) => id === 'inside-branch'));
					const outgoing = {
						id: `grandchild-to-right-${change.suffix}`,
						from: 'c',
						to: 'd',
					};
					const relations = [local];
					if (change.mode === 'incoming' || change.mode === 'both') relations.push(incoming);
					if (change.mode === 'outgoing' || change.mode === 'both') relations.push(outgoing);
					let nodes = source.nodes;
					let orderedRelations = relations;
					if (change.permuted) {
						nodes = [...source.nodes].reverse();
						orderedRelations = [...relations].reverse();
					}
					const document = {
						...source,
						nodes,
						relations: orderedRelations,
					};
					const prepared = prepareLayoutDocument(document);
					const incremental = solveNestedRegionLayoutForProjection(
						prepared.graph,
						prepared.measurements,
						input,
						cache,
					);
					const repeated = solveNestedRegionLayoutForProjection(
						prepared.graph,
						prepared.measurements,
						input,
						cache,
					);
					const cold = solveNestedRegionLayoutForProjection(
						prepared.graph,
						prepared.measurements,
						input,
						new RegionLocalLayoutCache(),
					);
					expect(incremental).toEqual(cold);
					expect(repeated).toEqual(cold);
					if (incremental.status === RegionCompositionStatus.Selected)
						expect(
							validateNestedRegionGeometry(prepared.graph, input, incremental),
						).toBeUndefined();
				}
				expect(cache.stats.hits).toBeGreaterThan(0);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
