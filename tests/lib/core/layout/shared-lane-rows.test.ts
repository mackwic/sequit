import { describe, expect, it } from 'vitest';

import {
	defined,
	LaneOrientation,
	type LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { verticalDirection } from '../../../../src/lib/core/layout/lanes/shared-lane-model';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import {
	boundsFor,
	layoutDocument,
	overlaps,
	progressesFromTo,
} from '../../../support/harnesses/layout';
import {
	LANE_ROW_DIRECTIONS,
	LANE_ROW_ORIENTATIONS,
	laneRowsDocument,
} from './shared-lane-rows-fixture';

const CONFIGURATIONS = LANE_ROW_ORIENTATIONS.flatMap((orientation) =>
	LANE_ROW_DIRECTIONS.map((direction) => [orientation, direction] as const),
);

/** The rank (long) and band (cross) coordinates of a box for one layout direction. */
function axes(direction: LayoutDirection): {
	readonly long: (bounds: Bounds) => number;
	readonly cross: (bounds: Bounds) => number;
} {
	if (verticalDirection(direction)) return { long: ({ y }) => y, cross: ({ x }) => x };
	return { long: ({ x }) => x, cross: ({ y }) => y };
}

describe('shared lane rows', () => {
	it.each(CONFIGURATIONS)(
		'places a parent documented after its sibling roots before its child (%s, %j)',
		async (orientation, direction) => {
			const { layout } = await layoutDocument(
				laneRowsDocument({
					direction,
					orientation,
					lanes: ['L1', 'L2'],
					nodes: [
						['a', 'L2'],
						['b', 'L2'],
						['c', 'L2'],
						['d', 'L1'],
					],
					relations: [['d', 'c']],
				}),
			);
			const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => boundsFor(layout, id));
			const { long } = axes(direction[0]);
			expect(layout.lanes?.map(({ id }) => id)).toEqual(['L1', 'L2']);
			// The three roots of L2 share one row, whatever their documentary order.
			expect(long(defined(a))).toBe(long(defined(c)));
			expect(long(defined(b))).toBe(long(defined(c)));
			if (orientation === LaneOrientation.Parallel)
				expect(progressesFromTo(defined(c), defined(d), direction[0])).toBe(true);
			// Transverse lanes keep their documentary order along the rank axis: L2 follows L1, so
			// the relation toward the later lane runs against the rank direction.
			else expect(progressesFromTo(defined(d), defined(c), direction[0])).toBe(true);
		},
	);

	it.each(CONFIGURATIONS)(
		'keeps three sibling children of one parent on one row (%s, %j)',
		async (orientation, direction) => {
			const { layout } = await layoutDocument(
				laneRowsDocument({
					direction,
					orientation,
					lanes: ['A', 'B'],
					nodes: [
						['a1', 'A'],
						['b1', 'B'],
						['b2', 'B'],
						['b3', 'B'],
					],
					relations: [
						['b1', 'a1'],
						['b2', 'a1'],
						['b3', 'a1'],
					],
				}),
			);
			const parent = boundsFor(layout, 'a1');
			const children = ['b1', 'b2', 'b3'].map((id) => boundsFor(layout, id));
			const { long, cross } = axes(direction[0]);
			expect(layout.lanes?.map(({ id }) => id)).toEqual(['A', 'B']);
			for (const child of children) {
				expect(long(child)).toBe(long(defined(children[0])));
				expect(progressesFromTo(parent, child, direction[0])).toBe(true);
			}
			const [first, second, third] = children.map((child) => defined(child));
			expect(overlaps(defined(first), defined(second))).toBe(false);
			expect(overlaps(defined(second), defined(third))).toBe(false);
			expect(cross(defined(first))).toBeLessThan(cross(defined(second)));
			expect(cross(defined(second))).toBeLessThan(cross(defined(third)));
		},
	);
});
