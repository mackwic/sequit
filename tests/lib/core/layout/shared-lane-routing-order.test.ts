import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import { defined, LaneOrientation } from '../../../../src/lib/core/document/logic-document';
import { configurations, documentFor, geometry } from './shared-lane-port-fixture';

describe('shared lane routing allocation order', () => {
	it('keeps route geometry fixed when IDs reverse two documentary gutter demands', () => {
		const document = documentFor(
			defined(configurations[3]),
			LaneOrientation.Parallel,
			[
				['a1', 'A'],
				['a2', 'A'],
				['b1', 'B'],
				['b2', 'B'],
			],
			[
				['a1', 'b2'],
				['a2', 'b2'],
			],
		);
		const renamed: typeof document = {
			...document,
			relations: document.relations.map((relation, index) => {
				let id = 'e1';
				if (index === 0) id = 'e3';
				return { ...relation, id };
			}),
		};
		const originalGeometry = geometry(document);
		const renamedGeometry = geometry(renamed);
		const routesWithoutIds = (result: typeof originalGeometry) =>
			result.relations
				.map(({ from, to, points }) => ({ from, to, points }))
				.toSorted(
					(left, right) =>
						compareCanonicalStrings(left.from, right.from) ||
						compareCanonicalStrings(left.to, right.to),
				);

		expect(routesWithoutIds(renamedGeometry)).toEqual(routesWithoutIds(originalGeometry));
	});
});
