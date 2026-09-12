import { describe, expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import type { Bounds, Point } from '../../../../src/lib/core/layout/layout-types';
import { centerRelatedRows } from '../../../../src/lib/core/layout/placement/center-related-rows';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import { packRails } from '../../../../src/lib/core/layout/routing/rail-packing';
import { anchorRouteToQuays } from '../../../../src/lib/core/layout/routing/route-quay-anchors';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { layoutDocument } from '../../../support/harnesses/layout';

describe('rail and quay reservations', () => {
	it('ignores cached measurements for nodes no longer present in the document', async () => {
		const fixture = await layoutDocument({
			...validLogicDocument(),
			junctions: [],
			relations: ['source-a', 'source-b'].flatMap((from) =>
				['target', 'isolated'].map((to) => ({ id: `${from}-${to}`, from, to })),
			),
		});
		const measured = {
			...fixture.measurements,
			nodes: new Map(fixture.measurements.nodes).set('removed-node', { width: 1000, height: 1000 }),
		};
		expect(await layoutGraph(fixture.graph, fixture.ranks, measured)).toEqual(fixture.layout);
	});
	it('creates an orthogonal dogleg when a formerly straight route receives different quays', () => {
		for (const vertical of [true, false]) {
			const points = [
				{ x: 0, y: 0 },
				{ x: 0, y: 100 },
			].map((point) => {
				if (vertical) return point;
				return { x: point.y, y: point.x };
			});
			const original = structuredClone(points);
			const expected = [
				{ x: 12, y: 0 },
				{ x: 12, y: 50 },
				{ x: -12, y: 50 },
				{ x: -12, y: 100 },
			].map((point) => {
				if (vertical) return point;
				return { x: point.y, y: point.x };
			});
			expect(anchorRouteToQuays(points, 12, -12, vertical)).toEqual(expected);
			expect(points).toEqual(original);
			expect(anchorRouteToQuays(points, 0, 0, vertical)).toBe(points);
		}
	});
	it('preserves intermediate obstacle bends while moving only the endpoint legs', () => {
		const points: Point[] = [
			{ x: 0, y: 0 },
			{ x: 0, y: 20 },
			{ x: 30, y: 20 },
			{ x: 30, y: 40 },
			{ x: 60, y: 40 },
			{ x: 60, y: 100 },
		];
		expect(anchorRouteToQuays(points, 12, -12, true)).toEqual([
			{ x: 12, y: 0 },
			{ x: 12, y: 20 },
			{ x: 30, y: 20 },
			{ x: 30, y: 40 },
			{ x: 48, y: 40 },
			{ x: 48, y: 100 },
		]);
	});
	it('reuses a rail for separated intervals but reserves different rails for nested intervals', () => {
		const runs = [
			{ start: 0, end: 100, rail: -1 },
			{ start: 0, end: 20, rail: -1 },
			{ start: 33, end: 50, rail: -1 },
		];
		expect(packRails(runs, 2)).toBe(2);
		expect(runs.map(({ rail }) => rail)).toEqual([3, 2, 2]);
	});
	it('breaks a column-constraint cycle while keeping direct wires straight', () => {
		const input = [
			{ id: 'left', source: 0, target: 0 },
			{ id: 'a', source: 48, target: 96 },
			{ id: 'b', source: 96, target: 48 },
			{ id: 'right', source: 144, target: 144 },
		];
		const snapshot = structuredClone(input);
		const result = routeChannel(input);
		expect(result.railCount).toBe(3);
		expect(result.wires.filter(({ middle }) => middle !== undefined)).toHaveLength(1);
		expect(result.wires.filter(({ first }) => first === undefined).map(({ id }) => id)).toEqual([
			'left',
			'right',
		]);
		expect(input).toEqual(snapshot);
		expect(routeChannel(input.toReversed()).wires).toEqual(result.wires.toReversed());
	});
	it('does not reserve a transverse rail for an empty or entirely straight channel', () => {
		expect(routeChannel([]).railCount).toBe(0);
		expect(routeChannel([{ id: 'direct', source: 0, target: 0 }]).railCount).toBe(0);
	});
	it('tolerates absent parent metadata and an empty component without invented alignment', () => {
		const bounds = new Map<string, Bounds>([
			['a', { x: 0, y: 0, width: 60, height: 20 }],
			['b', { x: 0, y: 100, width: 60, height: 20 }],
			['c', { x: 96, y: 100, width: 60, height: 20 }],
		]);
		for (const parents of [new Map<string, string[]>(), new Map([['b', ['a']]])]) {
			const original = structuredClone(bounds);
			centerRelatedRows({ rows: [['a'], ['b', 'c']], bounds, parents, vertical: true });
			expect(bounds).toEqual(original);
		}
		expect(
			centerRelatedRows({ rows: [[]], bounds: new Map(), parents: new Map(), vertical: true }),
		).toBe(1);
	});
});
