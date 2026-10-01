import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import {
	configurations,
	documentFor,
	normalized,
	orientations,
	rename,
} from './shared-lane-port-fixture';

const shapes = fc.integer({ min: 4, max: 6 }).chain((count) => {
	const indices = Array.from({ length: count }, (_, index) => index);
	const possiblePairs = indices.flatMap((to) =>
		indices.filter((from) => from > to).map((from): readonly [number, number] => [from, to]),
	);
	return fc.record({
		count: fc.constant(count),
		pairs: fc.shuffledSubarray(possiblePairs, { minLength: 2, maxLength: 4 }),
		permutation: fc.shuffledSubarray(indices, { minLength: count, maxLength: count }),
		lanes: fc.array(fc.nat(2), { minLength: count, maxLength: count }),
	});
});

describe.each(orientations)('lane node rename invariance (%s)', (orientation) => {
	for (const laneCount of [2, 3]) {
		it.each(configurations)(
			`preserves boxes and routes in ${laneCount} lanes in $direction`,
			(layout) => {
				fc.assert(
					fc.property(shapes, ({ count, pairs, permutation, lanes }) => {
						const nodes = Array.from({ length: count }, (_, index): readonly [string, string] => {
							let lane = index;
							if (index >= laneCount) lane = defined(lanes[index]) % laneCount;
							return [`n${index}`, `L${lane}`];
						});
						const document = documentFor(
							layout,
							orientation,
							nodes,
							pairs.map(([from, to]) => [`n${from}`, `n${to}`]),
						);
						const ids = new Map(
							permutation.map((value, index) => [`n${index}`, `renamed-${value}`]),
						);
						expect(normalized(rename(document, ids))).toEqual(normalized(document));
					}),
					PROPERTY_PARAMETERS,
				);
			},
		);
	}
});
