import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import type { Bounds, Point } from '../../../../src/lib/core/layout/layout-types';
import {
	prepareRouteObstacles,
	routeHitsObstacles,
} from '../../../../src/lib/core/layout/routing/route-obstacles';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

type Coordinate = readonly [number, number];

function line(from: Coordinate, to: Coordinate): readonly Point[] {
	return [
		{ x: from[0], y: from[1] },
		{ x: to[0], y: to[1] },
	];
}

const box: Bounds = { x: 10, y: 20, width: 30, height: 40 };
const cases: readonly {
	readonly label: string;
	readonly from: Coordinate;
	readonly to: Coordinate;
	readonly hits: boolean;
}[] = [
	{ label: 'horizontal crossing', from: [0, 40], to: [50, 40], hits: true },
	{ label: 'vertical crossing', from: [25, 10], to: [25, 70], hits: true },
	{ label: 'segment wholly inside', from: [15, 30], to: [30, 30], hits: true },
	{ label: 'only the end is inside', from: [0, 40], to: [25, 40], hits: true },
	{ label: 'top boundary', from: [0, 20], to: [50, 20], hits: false },
	{ label: 'bottom boundary', from: [0, 60], to: [50, 60], hits: false },
	{ label: 'left boundary', from: [10, 0], to: [10, 80], hits: false },
	{ label: 'right boundary', from: [40, 0], to: [40, 80], hits: false },
	{ label: 'ends at the left edge', from: [0, 40], to: [10, 40], hits: false },
	{ label: 'starts at the right edge', from: [40, 40], to: [50, 40], hits: false },
	{ label: 'ends at the top edge', from: [25, 0], to: [25, 20], hits: false },
	{ label: 'starts at the bottom edge', from: [25, 60], to: [25, 80], hits: false },
	{ label: 'corner contact', from: [0, 20], to: [10, 20], hits: false },
	{ label: 'outside rectangle', from: [0, 0], to: [0, 80], hits: false },
	{ label: 'duplicate interior point', from: [25, 40], to: [25, 40], hits: true },
	{ label: 'duplicate boundary point', from: [10, 40], to: [10, 40], hits: false },
];

describe('route obstacle queries', () => {
	it.each(cases)('$label is independent of segment direction', ({ from, to, hits }) => {
		const obstacles = prepareRouteObstacles([box], 0);
		expect(routeHitsObstacles(line(from, to), obstacles)).toBe(hits);
		expect(routeHitsObstacles(line(to, from), obstacles)).toBe(hits);
	});

	it('handles empty indexes and routes without segments', () => {
		expect(routeHitsObstacles(line([0, 40], [50, 40]), prepareRouteObstacles([], 12))).toBe(false);
		const obstacles = prepareRouteObstacles([box], 0);
		expect(routeHitsObstacles([], obstacles)).toBe(false);
		expect(routeHitsObstacles([{ x: 25, y: 40 }], obstacles)).toBe(false);
	});

	it('checks later segments of an orthogonal polyline', () => {
		const obstacles = prepareRouteObstacles([box], 0);
		expect(
			routeHitsObstacles(
				[
					{ x: 0, y: 0 },
					{ x: 0, y: 40 },
					{ x: 50, y: 40 },
				],
				obstacles,
			),
		).toBe(true);
	});

	it('expands obstacles by clearance while allowing exact contact with the new boundary', () => {
		const obstacles = prepareRouteObstacles([box], 5);
		expect(routeHitsObstacles(line([0, 17], [50, 17]), obstacles)).toBe(true);
		expect(routeHitsObstacles(line([0, 15], [50, 15]), obstacles)).toBe(false);
		expect(routeHitsObstacles(line([0, 65], [50, 65]), obstacles)).toBe(false);
		expect(routeHitsObstacles(line([7, 0], [7, 80]), obstacles)).toBe(true);
		expect(routeHitsObstacles(line([5, 0], [5, 80]), obstacles)).toBe(false);
		expect(routeHitsObstacles(line([45, 0], [45, 80]), obstacles)).toBe(false);
	});

	it('copies geometry without sorting or retaining mutable caller bounds', () => {
		const first = { x: 100, y: 0, width: 20, height: 20 };
		const second = { ...box };
		const boxes = [first, second];
		const snapshot = structuredClone(boxes);
		const obstacles = prepareRouteObstacles(boxes, 0);
		expect(boxes).toEqual(snapshot);
		second.x = 1_000;
		expect(routeHitsObstacles(line([0, 40], [50, 40]), obstacles)).toBe(true);
		expect(routeHitsObstacles(line([990, 40], [1_040, 40]), obstacles)).toBe(false);
	});

	it('retains distinct and identical rectangles sharing the same left boundary', () => {
		const boxes = [
			box,
			{ ...box },
			{ ...box, height: 100 },
			{ ...box, width: 100 },
			{ ...box, y: 10 },
		];
		const obstacles = prepareRouteObstacles(boxes, 0);
		expect(routeHitsObstacles(line([20, 100], [30, 100]), obstacles)).toBe(true);
		expect(routeHitsObstacles(line([90, 30], [100, 30]), obstacles)).toBe(true);
		expect(routeHitsObstacles(line([20, 130], [30, 130]), obstacles)).toBe(false);
	});

	it('treats zero-area boxes as empty until clearance gives them an interior', () => {
		const empty = { x: 10, y: 10, width: 0, height: 0 };
		const query = line([0, 10], [20, 10]);
		expect(routeHitsObstacles(query, prepareRouteObstacles([empty], 0))).toBe(false);
		expect(routeHitsObstacles(query, prepareRouteObstacles([empty], 1))).toBe(true);
	});

	it('queries both ends and gaps of a large sparse obstacle set', () => {
		const boxes = Array.from({ length: 2_048 }, (_, index) => ({
			x: index * 20,
			y: 0,
			width: 10,
			height: 10,
		}));
		const obstacles = prepareRouteObstacles(boxes, 0);
		expect(routeHitsObstacles(line([5, -10], [5, 20]), obstacles)).toBe(true);
		expect(routeHitsObstacles(line([40_945, -10], [40_945, 20]), obstacles)).toBe(true);
		expect(routeHitsObstacles(line([15, -10], [15, 20]), obstacles)).toBe(false);
		expect(routeHitsObstacles(line([-10, 20], [41_000, 20]), obstacles)).toBe(false);
	});

	it('rejects a diagonal query instead of mistaking its bounding box for a route', () => {
		expect(() =>
			routeHitsObstacles(line([0, 0], [100, 100]), prepareRouteObstacles([box], 0)),
		).toThrow('orthogonal segments');
	});
});

/** Independent oracle: clip a parameterized segment against the open rectangle on both axes. */
function clippedInterior(from: Point, to: Point, box: Bounds, clearance: number): boolean {
	const limits = [
		{ from: from.x, to: to.x, low: box.x - clearance, high: box.x + box.width + clearance },
		{ from: from.y, to: to.y, low: box.y - clearance, high: box.y + box.height + clearance },
	];
	let enter = 0;
	let leave = 1;
	for (const axis of limits) {
		if (axis.low >= axis.high) return false;
		const delta = axis.to - axis.from;
		if (delta === 0) {
			if (axis.from <= axis.low || axis.from >= axis.high) return false;
			continue;
		}
		const first = (axis.low - axis.from) / delta;
		const last = (axis.high - axis.from) / delta;
		enter = Math.max(enter, Math.min(first, last));
		leave = Math.min(leave, Math.max(first, last));
	}
	return enter < leave;
}

function bruteForce(
	points: readonly Point[],
	boxes: readonly Bounds[],
	clearance: number,
): boolean {
	return points.some((point, index) => {
		if (index === 0) return false;
		return boxes.some((entry) =>
			clippedInterior(defined(points[index - 1]), point, entry, clearance),
		);
	});
}

const boxes = fc.array(
	fc.record({
		x: fc.integer({ min: -200, max: 200 }),
		y: fc.integer({ min: -200, max: 200 }),
		width: fc.integer({ min: 0, max: 60 }),
		height: fc.integer({ min: 0, max: 60 }),
	}),
	{ maxLength: 40 },
);

const polyline = fc
	.record({
		x: fc.integer({ min: -200, max: 200 }),
		y: fc.integer({ min: -200, max: 200 }),
		steps: fc.array(
			fc.record({ vertical: fc.boolean(), distance: fc.integer({ min: -100, max: 100 }) }),
			{ maxLength: 15 },
		),
	})
	.map(({ x, y, steps }): readonly Point[] => {
		const points: Point[] = [{ x, y }];
		let nextX = x;
		let nextY = y;
		for (const step of steps) {
			if (step.vertical) nextY += step.distance;
			else nextX += step.distance;
			points.push({ x: nextX, y: nextY });
		}
		return points;
	});

it('matches independent exhaustive clipping across varied boxes, polylines and clearances', () => {
	fc.assert(
		fc.property(boxes, polyline, fc.integer({ min: 0, max: 24 }), (entries, points, clearance) => {
			const frozen = Object.freeze(entries.map((entry) => Object.freeze(entry)));
			const obstacles = prepareRouteObstacles(frozen, clearance);
			const expected = bruteForce(points, entries, clearance);
			expect(routeHitsObstacles(points, obstacles)).toBe(expected);
			expect(routeHitsObstacles(points.toReversed(), obstacles)).toBe(expected);
			expect(
				routeHitsObstacles(points, prepareRouteObstacles(entries.toReversed(), clearance)),
			).toBe(expected);
		}),
		PROPERTY_PARAMETERS,
	);
});

it('preserves the answer after translating all coordinates', () => {
	fc.assert(
		fc.property(
			boxes,
			polyline,
			fc.integer({ min: 0, max: 24 }),
			fc.integer({ min: -500, max: 500 }),
			fc.integer({ min: -500, max: 500 }),
			(entries, points, clearance, dx, dy) => {
				const expected = routeHitsObstacles(points, prepareRouteObstacles(entries, clearance));
				const movedBoxes = entries.map((entry) => ({ ...entry, x: entry.x + dx, y: entry.y + dy }));
				const movedPoints = points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
				expect(routeHitsObstacles(movedPoints, prepareRouteObstacles(movedBoxes, clearance))).toBe(
					expected,
				);
			},
		),
		PROPERTY_PARAMETERS,
	);
});
