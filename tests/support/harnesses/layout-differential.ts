import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

import type { LogicDocument } from '../../../src/lib/core/document/logic-document';
import { layoutWithDedicatedEngine } from '../../../src/lib/core/layout/layout-engine';
import type { LayoutOptions, LayoutResult } from '../../../src/lib/core/layout/layout-types';
import type { LayoutMeasurementOverrides } from '../builders/layout-measurements';
import { type PreparedLayoutDocument, prepareLayoutDocument } from './layout';

export interface LayoutDifferentialCase {
	readonly document: LogicDocument;
	readonly measurements?: LayoutMeasurementOverrides;
	readonly options?: LayoutOptions;
	readonly label?: string;
}

export type LayoutCandidate = (
	input: PreparedLayoutDocument,
	options: LayoutOptions,
) => LayoutResult | Promise<LayoutResult>;

function firstDifference(actual: LayoutResult, baseline: LayoutResult): string {
	if (actual.width !== baseline.width) return `width (${baseline.width} → ${actual.width})`;
	if (actual.height !== baseline.height) return `height (${baseline.height} → ${actual.height})`;
	if (actual.elements.length !== baseline.elements.length) return 'element count';
	const elementIndex = baseline.elements.findIndex(
		(element, index) => !isDeepStrictEqual(element, actual.elements[index]),
	);
	if (elementIndex !== -1) return `element ${baseline.elements[elementIndex]?.id ?? elementIndex}`;
	if (actual.relations.length !== baseline.relations.length) return 'relation count';
	const relationIndex = baseline.relations.findIndex(
		(relation, index) => !isDeepStrictEqual(relation, actual.relations[index]),
	);
	if (relationIndex !== -1)
		return `relation ${baseline.relations[relationIndex]?.id ?? relationIndex}`;
	return 'routing inspection';
}

/** Compare the pre-wrapper engine to a candidate after independently preparing identical inputs. */
export async function assertLayoutEquivalent(
	{ document, measurements = {}, options = {}, label = document.id }: LayoutDifferentialCase,
	candidate: LayoutCandidate,
): Promise<LayoutResult> {
	const baselineInput = prepareLayoutDocument(
		structuredClone(document),
		structuredClone(measurements),
	);
	const candidateInput = prepareLayoutDocument(
		structuredClone(document),
		structuredClone(measurements),
	);
	const baseline = layoutWithDedicatedEngine(
		baselineInput.graph,
		baselineInput.ranks,
		baselineInput.measurements,
		structuredClone(options),
	);
	const actual = await candidate(candidateInput, structuredClone(options));
	assert.deepStrictEqual(
		actual,
		baseline,
		`Layout mismatch for ${label} (document ${document.id}, direction ${document.layout.direction}, bias ${document.layout.bias}, inspectRouting ${String(options.inspectRouting ?? false)}): ${firstDifference(actual, baseline)}`,
	);
	return baseline;
}
