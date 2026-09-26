import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	DedicatedCandidateRejectionCode,
	validateDedicatedCandidate,
} from '../../../../src/lib/core/layout/dedicated-candidate-validation';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

function fixture() {
	const document = validLogicDocument();
	const prepared = prepareLayoutDocument({
		...document,
		relations: document.relations.filter(({ id }) => id !== 'group-to-target'),
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	return { ...prepared, layout };
}

function replaceBounds(
	layout: LayoutResult,
	id: string,
	bounds: LayoutResult['elements'][number]['bounds'],
): LayoutResult {
	return {
		...layout,
		elements: layout.elements.map((element) => {
			if (element.id !== id) return element;
			return { ...element, bounds };
		}),
	};
}

const source = fixture();
const collectionOrder = fc.tuple(
	fc.shuffledSubarray([...source.layout.elements], {
		minLength: source.layout.elements.length,
		maxLength: source.layout.elements.length,
	}),
	fc.shuffledSubarray([...source.layout.relations], {
		minLength: source.layout.relations.length,
		maxLength: source.layout.relations.length,
	}),
);

describe('dedicated candidate validation properties', () => {
	it('is invariant to element and route collection permutations for valid candidates', () => {
		const expected = validateDedicatedCandidate(source);
		expect(expected).toMatchObject({ valid: true });
		fc.assert(
			fc.property(collectionOrder, ([elements, relations]) => {
				const layout = { ...source.layout, elements, relations };
				expect(validateDedicatedCandidate({ ...source, layout })).toEqual(expected);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('chooses the same overlap witness after permuting candidate elements', () => {
		const target = source.layout.elements.find(({ id }) => id === 'target');
		const isolated = source.layout.elements.find(({ id }) => id === 'isolated');
		if (target === undefined || isolated === undefined)
			throw new Error('Expected separate node boxes');
		const overlapLayout = replaceBounds(source.layout, isolated.id, target.bounds);
		const expected = validateDedicatedCandidate({ ...source, layout: overlapLayout });
		expect(expected).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.ElementOverlap,
		});
		const elementsOrder = fc.shuffledSubarray([...overlapLayout.elements], {
			minLength: overlapLayout.elements.length,
			maxLength: overlapLayout.elements.length,
		});
		fc.assert(
			fc.property(elementsOrder, (elements) => {
				const layout = { ...overlapLayout, elements };
				expect(validateDedicatedCandidate({ ...source, layout })).toEqual(expected);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
