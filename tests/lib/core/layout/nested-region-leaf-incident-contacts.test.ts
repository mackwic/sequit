import { describe, expect, it } from 'vitest';

import type { Point } from '../../../../src/lib/core/layout/layout-types';
import { pathsTouchWithoutBridge } from '../../../../src/lib/core/layout/nested-region-leaf-incident-contacts';

function path(...coordinates: readonly [number, number][]): readonly Point[] {
	return coordinates.map(([x, y]) => ({ x, y }));
}

describe('contacts between a leaf incident and a local route', () => {
	it('accepts disjoint parallel and perpendicular segments', () => {
		expect(pathsTouchWithoutBridge(path([1, 0], [1, 3]), path([2, 0], [2, 3]))).toBe(false);
		expect(pathsTouchWithoutBridge(path([0, 1], [3, 1]), path([0, 2], [3, 2]))).toBe(false);
		expect(pathsTouchWithoutBridge(path([1, 0], [1, 2]), path([2, 3], [4, 3]))).toBe(false);
		expect(pathsTouchWithoutBridge(path([0, 3], [2, 3]), path([3, 0], [3, 2]))).toBe(false);
	});

	it('finds overlapping vertical and horizontal route segments in either direction', () => {
		expect(pathsTouchWithoutBridge(path([1, 4], [1, 0]), path([1, 2], [1, 6]))).toBe(true);
		expect(pathsTouchWithoutBridge(path([4, 1], [0, 1]), path([2, 1], [6, 1]))).toBe(true);
		expect(pathsTouchWithoutBridge(path([1, 0], [1, 2]), path([1, 3], [1, 5]))).toBe(false);
		expect(pathsTouchWithoutBridge(path([0, 1], [2, 1]), path([3, 1], [5, 1]))).toBe(false);
	});

	it('finds both perpendicular crossing orientations', () => {
		expect(pathsTouchWithoutBridge(path([1, 0], [1, 3]), path([0, 2], [3, 2]))).toBe(true);
		expect(pathsTouchWithoutBridge(path([0, 2], [3, 2]), path([1, 0], [1, 3]))).toBe(true);
	});

	it('allows a shared node-face point but rejects an overlap beyond it', () => {
		const nodeFace = { x: 1, y: 1 };
		expect(pathsTouchWithoutBridge(path([1, 1], [1, 3]), path([0, 1], [1, 1]), nodeFace)).toBe(
			false,
		);
		expect(pathsTouchWithoutBridge(path([1, 1], [1, 3]), path([1, 1], [1, 2]), nodeFace)).toBe(
			true,
		);
		expect(pathsTouchWithoutBridge(path([1, 1], [1, 3]), path([0, 1], [1, 1]))).toBe(true);
	});

	it('inspects later bends as well as the first segment', () => {
		expect(pathsTouchWithoutBridge(path([0, 0], [0, 2], [3, 2]), path([2, 0], [2, 3]))).toBe(true);
	});

	it('treats a missing route point as an unbridgeable contact', () => {
		const missingFirst = new Array<Point>(2);
		missingFirst[1] = { x: 0, y: 2 };
		const missingLast = new Array<Point>(2);
		missingLast[0] = { x: 0, y: 0 };
		const complete = path([1, 0], [1, 2]);

		expect(pathsTouchWithoutBridge(missingFirst, complete)).toBe(true);
		expect(pathsTouchWithoutBridge(missingLast, complete)).toBe(true);
		expect(pathsTouchWithoutBridge(complete, missingFirst)).toBe(true);
		expect(pathsTouchWithoutBridge(complete, missingLast)).toBe(true);
	});
});
