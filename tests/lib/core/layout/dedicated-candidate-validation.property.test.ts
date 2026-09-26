import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import {
	DedicatedCandidateRejectionCode,
	validateDedicatedCandidate,
} from '../../../../src/lib/core/layout/dedicated-candidate-validation';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { acyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
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
	it('accepts routed acyclic documents across directions and rank shapes', () => {
		fc.assert(
			fc.property(
				acyclicLogicDocumentArbitrary({ minNodes: 3, maxNodes: 12, minEdges: 2, maxEdges: 16 }),
				(document) => {
					const prepared = createGraph(document);
					if (!prepared.ok) throw new Error('Invalid generated acyclic graph');
					const graph = prepared.value;
					const ranks = topologicallyRank(graph);
					const measurements = layoutMeasurementsFor(document);
					const layout = layoutWithDedicatedEngine(graph, ranks, measurements);
					expect(validateDedicatedCandidate({ graph, ranks, measurements, layout })).toMatchObject({
						valid: true,
					});
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

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

	it('selects the same first faulty group member across document and result permutations', () => {
		const container = defined(source.layout.elements.find(({ id }) => id === 'container'));
		const outside = { ...container.bounds, x: container.bounds.x + container.bounds.width + 4 };
		const invalid = replaceBounds(
			replaceBounds(source.layout, 'source-a', outside),
			'source-b',
			outside,
		);
		const expected = validateDedicatedCandidate({ ...source, layout: invalid });
		expect(expected).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.GroupContainment,
			endpointId: 'source-a',
		});
		fc.assert(
			fc.property(
				fc.shuffledSubarray([...source.document.nodes], {
					minLength: source.document.nodes.length,
					maxLength: source.document.nodes.length,
				}),
				fc.shuffledSubarray([...source.document.groups], {
					minLength: source.document.groups.length,
					maxLength: source.document.groups.length,
				}),
				fc.shuffledSubarray([...invalid.elements], {
					minLength: invalid.elements.length,
					maxLength: invalid.elements.length,
				}),
				(nodes, groups, elements) => {
					const prepared = prepareLayoutDocument({ ...source.document, nodes, groups });
					expect(
						validateDedicatedCandidate({ ...prepared, layout: { ...invalid, elements } }),
					).toEqual(expected);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('names a contacting route pair canonically regardless of document and result order', () => {
		const first = defined(source.layout.relations.find(({ id }) => id === 'a-to-choice'));
		const second = defined(source.layout.relations.find(({ id }) => id === 'b-to-choice'));
		const secondStart = defined(second.points[0]);
		const secondBend = defined(second.points[1]);
		const sharedStart = defined(first.points[2]);
		const targetPort = defined(first.points.at(-1));
		const rejoined = {
			...second,
			points: [
				secondStart,
				secondBend,
				sharedStart,
				{ x: sharedStart.x, y: sharedStart.y + 12 },
				{ x: sharedStart.x + 28, y: sharedStart.y + 12 },
				{ x: sharedStart.x + 28, y: targetPort.y - 6 },
				{ x: sharedStart.x, y: targetPort.y - 6 },
				targetPort,
			],
		};
		const invalid = {
			...source.layout,
			relations: source.layout.relations.map((route) => {
				if (route.id === second.id) return rejoined;
				return route;
			}),
		};
		const expected = validateDedicatedCandidate({ ...source, layout: invalid });
		expect(expected).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.RouteContact,
			relationId: first.id,
			otherRelationId: second.id,
		});
		fc.assert(
			fc.property(
				fc.shuffledSubarray([...source.document.relations], {
					minLength: source.document.relations.length,
					maxLength: source.document.relations.length,
				}),
				fc.shuffledSubarray([...invalid.relations], {
					minLength: invalid.relations.length,
					maxLength: invalid.relations.length,
				}),
				(relations, routes) => {
					const prepared = prepareLayoutDocument({ ...source.document, relations });
					expect(
						validateDedicatedCandidate({ ...prepared, layout: { ...invalid, relations: routes } }),
					).toEqual(expected);
				},
			),
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
			endpointId: 'isolated',
			otherEndpointId: 'target',
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
