import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { serializeLogicDocumentDot } from '../../../../src/lib/infrastructure/dot/serialize-logic-document-dot';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

describe('DOT export determinism', () => {
	it('is independent of every document collection order', () => {
		fc.assert(
			fc.property(richAcyclicLogicDocumentArbitrary(), (document) => {
				const reversed = {
					...document,
					natures: [...document.natures].reverse(),
					groups: [...document.groups].reverse(),
					nodes: [...document.nodes].reverse(),
					junctions: [...document.junctions].reverse(),
					relations: [...document.relations].reverse(),
				};
				expect(serializeLogicDocumentDot(reversed)).toBe(serializeLogicDocumentDot(document));
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
