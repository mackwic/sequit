import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import {
	directRouteFitsSpace,
	directRouteRail,
	directRoutingSpace,
	routingSpace,
} from '../../../../src/lib/core/layout/routing/routing-space';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';

describe.each(Object.values(LayoutDirection))('free routing space in %s', (direction) => {
	const frame = createLayoutFrame(direction, defaultBiasFor(direction));
	function box(start: number, end: number, transverse = 0, breadth = 80): Bounds {
		let main = start;
		if (!frame.forward) main = -end;
		if (frame.vertical) return { x: transverse, y: main, width: breadth, height: end - start };
		return { x: main, y: transverse, width: end - start, height: breadth };
	}
	function prepare(
		rows: readonly (readonly string[])[],
		boxes: Readonly<Record<string, Bounds>>,
		junctionIds: readonly string[] = [],
		enclosingGroups: readonly string[] = [],
	) {
		return directRoutingSpace({
			layers: {
				rows,
				byId: new Map(rows.flatMap((row, index) => row.map((id) => [id, index] as const))),
				intervals: [],
			},
			bounds: new Map(Object.entries(boxes)),
			frame,
			junctionIds: new Set(junctionIds),
			enclosingGroups: new Set(enclosingGroups),
		});
	}
	function physical(coordinate: number): number {
		if (!frame.forward) return -coordinate;
		return coordinate;
	}

	it('uses the free gap of whole atomic layers and ignores enclosing group envelopes', () => {
		const rows = [
			['target', 'target-peer', 'group'],
			['source', 'source-peer'],
		];
		const boxes = {
			target: box(0, 40),
			'target-peer': box(-20, 100, 200),
			source: box(220, 260),
			'source-peer': box(200, 280, 200),
			group: box(-100, 500, -40, 400),
		};
		const original = structuredClone({ rows, boxes });
		const space = prepare(rows, boxes, [], ['group']);
		expect(space.extents).toEqual([
			{ start: -20, end: 100 },
			{ start: 200, end: 280 },
		]);
		expect(space.obstacles.size).toBe(0);
		expect(directRouteRail(space, 'source', 'target')).toBe(physical(150));
		expect(directRouteFitsSpace(space, 'source', 'target')).toBe(true);
		expect(directRouteRail(space, 'source', 'group')).toBeUndefined();
		expect(directRouteRail(space, 'group', 'source')).toBeUndefined();
		expect(directRouteFitsSpace(space, 'source', 'group')).toBe(false);
		expect({ rows, boxes }).toEqual(original);
		expect([...space.bounds]).toEqual(Object.entries(original.boxes));
	});

	it('does not invent a rail for reversed endpoints or endpoints on the same layer', () => {
		const space = prepare([['target'], ['source', 'peer']], {
			target: box(0, 40),
			source: box(200, 240),
			peer: box(200, 240, 200),
		});
		for (const [from, to] of [
			['target', 'source'],
			['source', 'peer'],
		] as const) {
			expect(directRouteRail(space, from, to)).toBeUndefined();
			expect(directRouteFitsSpace(space, from, to)).toBe(false);
		}
	});

	it('does not invent a common rail when the bordering layer envelopes overlap', () => {
		const space = prepare([['target', 'tall-peer'], ['source']], {
			target: box(0, 40),
			'tall-peer': box(0, 220, 200),
			source: box(200, 240),
		});
		expect(directRouteRail(space, 'source', 'target')).toBeUndefined();
		expect(directRouteFitsSpace(space, 'source', 'target')).toBe(false);
	});

	it.each([
		{ transverse: 64, expected: true, gap: 24 },
		{ transverse: 63, expected: false, gap: 23 },
	])('shares a junction layer only with enough clearance ($gap px)', ({ transverse, expected }) => {
		const rows = [['target'], ['junction'], ['source']];
		const boxes = {
			target: box(0, 40),
			junction: box(120, 140, transverse, 28),
			source: box(240, 280),
		};
		const original = structuredClone(boxes);
		const space = prepare(rows, boxes, ['junction']);
		const railSpace = routingSpace(space);
		expect(Object.hasOwn(railSpace, 'obstacles')).toBe(false);
		expect(railSpace.extents).toEqual(space.extents);
		expect([...space.obstacles.keys()]).toEqual([1]);
		expect(directRouteRail(railSpace, 'source', 'target')).toBe(physical(140));
		expect(directRouteFitsSpace(space, 'source', 'target')).toBe(expected);
		expect(boxes).toEqual(original);
	});

	it('checks the transverse turn against every box sharing the junction layer', () => {
		const space = prepare(
			[['target'], ['junction', 'ordinary'], ['source']],
			{
				target: box(0, 40),
				junction: box(120, 140, 400, 28),
				ordinary: box(120, 140, 100),
				source: box(240, 280, 200),
			},
			['junction'],
		);
		expect(directRouteFitsSpace(space, 'source', 'target')).toBe(false);
	});

	it('does not skip an ordinary intermediate layer even if its boxes are off the direct route', () => {
		const space = prepare([['target'], ['ordinary'], ['source']], {
			target: box(0, 40),
			ordinary: box(120, 140, 400),
			source: box(240, 280),
		});
		expect(space.obstacles.size).toBe(0);
		expect(directRouteFitsSpace(space, 'source', 'target')).toBe(false);
	});

	it('rejects a later blocked junction layer after crossing a free one', () => {
		const space = prepare(
			[['target'], ['first'], ['second'], ['source']],
			{
				target: box(0, 40),
				first: box(100, 120, 300, 28),
				second: box(240, 260, 26, 28),
				source: box(360, 400),
			},
			['first', 'second'],
		);
		expect([...space.obstacles.keys()]).toEqual([1, 2]);
		expect(directRouteFitsSpace(space, 'source', 'target')).toBe(false);
	});

	it('accepts empty preparation without manufacturing obstacles or finite extents', () => {
		const empty = prepare([], {});
		expect(empty.extents).toEqual([]);
		expect(empty.obstacles.size).toBe(0);
		const emptyLayer = prepare([[]], {});
		expect(emptyLayer.extents).toEqual([
			{ start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY },
		]);
		expect(emptyLayer.obstacles.size).toBe(0);
	});
});
