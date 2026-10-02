import { describe, expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import type { Bounds, LayoutRelation } from '../../../../src/lib/core/layout/layout-types';
import { routeCrossings } from '../../../support/assertions/route-geometry';
import { boundsFor, layoutDocument } from '../../../support/harnesses/layout';
import { persistedCellGrid } from './grid-cell-fixture';

const FLOWS = [
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
] as const;

function routeLength({ points }: LayoutRelation): number {
	let length = 0;
	for (const [index, point] of points.slice(1).entries()) {
		const previous = defined(points[index]);
		length += Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
	}
	return length;
}

/** Direction changes along the route; collinear points do not count. */
function bends({ points }: LayoutRelation): number {
	let count = 0;
	for (const [index, point] of points.slice(2).entries()) {
		const first = defined(points[index]);
		const middle = defined(points[index + 1]);
		const before = first.y === middle.y;
		const after = middle.y === point.y;
		if (before !== after) count += 1;
	}
	return count;
}

function inside(bounds: Bounds, x: number, y: number): boolean {
	return (
		x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
	);
}

describe('crossings between neighbouring grid cells', () => {
	it.each(FLOWS)(
		'joins the two upper cells through the column gap between them ($direction)',
		async (flow) => {
			const document = persistedCellGrid(2, [['n0'], ['n1'], ['n2'], ['n3']], [['n0', 'n1']], flow);
			const { layout } = await layoutDocument(document);
			const route = defined(layout.relations.find(({ id }) => id === 'r0'));
			const source = boundsFor(layout, 'n0');
			const target = boundsFor(layout, 'n1');
			const facing = target.x - (source.x + source.width);
			expect(facing).toBeGreaterThan(0);
			// Out of n0's right face, into n1's left face: before G-02, 1 564 px around the grid.
			expect(defined(route.points[0]).x).toBe(source.x + source.width);
			expect(defined(route.points.at(-1)).x).toBe(target.x);
			expect(routeLength(route)).toBeLessThanOrEqual(2 * facing);
			expect(bends(route)).toBeLessThanOrEqual(2);
			expect(routeCrossings(layout.relations)).toEqual([]);
			const regions = new Map((layout.regions ?? []).map(({ id, bounds }) => [id, bounds]));
			const left = defined(regions.get('c0'));
			for (const { y } of route.points) {
				expect(y).toBeGreaterThanOrEqual(left.y);
				expect(y).toBeLessThanOrEqual(left.y + left.height);
			}
		},
	);

	it.each(FLOWS)(
		'joins two cells of one column through the row gap between them ($direction)',
		async (flow) => {
			const document = persistedCellGrid(2, [['a'], ['b'], ['c'], ['d']], [['c', 'a']], flow);
			const { layout } = await layoutDocument(document);
			const route = defined(layout.relations.find(({ id }) => id === 'r0'));
			const source = boundsFor(layout, 'c');
			const target = boundsFor(layout, 'a');
			const facing = source.y - (target.y + target.height);
			// Out of c's top face, into a's bottom face, never on the rail left of the grid.
			expect(defined(route.points[0]).y).toBe(source.y);
			expect(defined(route.points.at(-1)).y).toBe(target.y + target.height);
			expect(routeLength(route)).toBeLessThanOrEqual(2 * facing);
			expect(bends(route)).toBeLessThanOrEqual(2);
			const regions = new Map((layout.regions ?? []).map(({ id, bounds }) => [id, bounds]));
			const column = defined(regions.get('c0'));
			for (const { x } of route.points) {
				expect(x).toBeGreaterThan(column.x);
				expect(x).toBeLessThan(column.x + column.width);
			}
		},
	);

	it.each(FLOWS)(
		'keeps the jog between misaligned neighbours inside the gap between them ($direction)',
		async (flow) => {
			// A taller n1 centres its left face below n0's right face: the route jogs once in the gap.
			const document = persistedCellGrid(2, [['n0'], ['n1'], ['n2'], ['n3']], [['n0', 'n1']], flow);
			const { layout } = await layoutDocument(document, {
				nodes: { n1: { width: 220, height: 260 } },
			});
			const route = defined(layout.relations.find(({ id }) => id === 'r0'));
			const regions = new Map((layout.regions ?? []).map(({ id, bounds }) => [id, bounds]));
			const left = defined(regions.get('c0'));
			const right = defined(regions.get('c1'));
			const gap = { x: left.x + left.width, width: right.x - left.x - left.width };
			const span = {
				x: left.x,
				y: left.y,
				width: right.x + right.width - left.x,
				height: left.height,
			};
			for (const { x, y } of route.points) expect(inside(span, x, y)).toBe(true);
			expect(bends(route)).toBe(2);
			const jog = route.points.filter(({ x }) => x > gap.x && x < gap.x + gap.width);
			expect(jog).toHaveLength(2);
			expect(defined(jog[0]).x).toBe(defined(jog[1]).x);
		},
	);

	it('never keeps a gap form longer than the gutter form of the same allocation', async () => {
		// Corpus random-159, right to left: the gap form of n7→n1 that detours around n1's siblings
		// took 1 692 px where the gutter form took 1 384 px; the shorter valid form must win.
		const document = persistedCellGrid(
			2,
			[['n0'], ['n1', 'n2', 'n3'], ['n4', 'n5'], ['n6', 'n7']],
			[
				['n3', 'n1'],
				['n7', 'n1'],
			],
			{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
		);
		const { layout } = await layoutDocument(document);
		const route = defined(layout.relations.find(({ id }) => id === 'r1'));
		expect(routeLength(route)).toBeLessThanOrEqual(1384);
		expect(routeCrossings(layout.relations)).toEqual([]);
	});
});
