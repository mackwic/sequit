import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { GroupRouteFailure } from '../../../../src/lib/core/layout/layout-types';
import { groupedCaseArbitrary } from '../../../support/builders/grouped-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

it('lays out every small grouped document or reports a typed group route failure', () => {
	fc.assert(
		fc.property(groupedCaseArbitrary, ({ document, nodes, groups }) => {
			fc.pre(createGraph(document).ok);
			const prepared = prepareLayoutDocument(document, { nodes, groups });
			try {
				layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
			} catch (error) {
				expect(error).toBeInstanceOf(GroupRouteFailure);
			}
		}),
		PROPERTY_PARAMETERS,
	);
});
