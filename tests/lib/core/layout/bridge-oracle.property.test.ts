import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	unbridgedContacts,
	unbridgedCrossings,
} from '../../../../src/lib/core/layout/bridges/bridge-contact';
import {
	type LayoutBridge,
	type RoutedPath,
	RouteOrientation,
	type RouteRun,
	routeRuns,
	strictCrossings,
	validatedBridges,
	validatedBridgesCached,
} from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import type { Point } from '../../../../src/lib/core/layout/layout-types';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

function relation(id: string, points: readonly Point[]): RoutedPath {
	return { id, points };
}

/** The run of one route that passes through the point strictly inside itself. */
function interiorRun(path: RoutedPath, point: Point): RouteRun | undefined {
	return routeRuns(path).find((run) => {
		if (run.orientation === RouteOrientation.Horizontal)
			return (
				run.start.y === point.y &&
				point.x > Math.min(run.start.x, run.end.x) &&
				point.x < Math.max(run.start.x, run.end.x)
			);
		return (
			run.start.x === point.x &&
			point.y > Math.min(run.start.y, run.end.y) &&
			point.y < Math.max(run.start.y, run.end.y)
		);
	});
}

/** The distance from the point to the nearer end of the run it lies on. */
function clearance(run: RouteRun, point: Point): number {
	let axis: 'x' | 'y' = 'y';
	if (run.orientation === RouteOrientation.Horizontal) axis = 'x';
	const coordinate = point[axis];
	const low = Math.min(run.start[axis], run.end[axis]);
	const high = Math.max(run.start[axis], run.end[axis]);
	return Math.min(coordinate - low, high - coordinate);
}

/** A bridge mark is a claim on one point and one ordered pair: the checks below re-read it. */
function covers(bridge: LayoutBridge, point: Point, firstId: string, secondId: string): boolean {
	if (bridge.x !== point.x || bridge.y !== point.y) return false;
	const forward = bridge.carrierIds.includes(firstId) && bridge.crossedIds.includes(secondId);
	const backward = bridge.carrierIds.includes(secondId) && bridge.crossedIds.includes(firstId);
	return forward || backward;
}

function samePoint(left: Point, right: Point): boolean {
	return left.x === right.x && left.y === right.y;
}

const horizontalCrossing = relation('horizontal', [
	{ x: 0, y: 50 },
	{ x: 100, y: 50 },
]);
const verticalCrossing = relation('vertical', [
	{ x: 50, y: 0 },
	{ x: 50, y: 100 },
]);

describe('the bridge oracle', () => {
	it('is invariant to route permutations, including simultaneous contacts', () => {
		const third = relation('third', [
			{ x: 50, y: 0 },
			{ x: 50, y: 100 },
		]);
		const routes = [horizontalCrossing, verticalCrossing, third] as const;
		const expected = routeBridgeAnalysisIn(routes);
		const permutations: readonly (readonly RoutedPath[])[] = [
			[...routes].reverse(),
			[routes[1], routes[2], routes[0]],
			[routes[2], routes[0], routes[1]],
		];
		for (const permutation of permutations)
			expect(routeBridgeAnalysisIn(permutation)).toEqual(expected);
	});
	it('draws one bridge on the later route of a strict crossing with room on both runs', () => {
		expect(validatedBridges([horizontalCrossing, verticalCrossing])).toEqual([
			{ x: 50, y: 50, carrierIds: ['vertical'], crossedIds: ['horizontal'] },
		]);
		expect(strictCrossings([horizontalCrossing, verticalCrossing])).toEqual([
			{ x: 50, y: 50, horizontalId: 'horizontal', verticalId: 'vertical' },
		]);
	});

	it('does not carry a prior candidate bridge into a different route set', () => {
		const crossing = [horizontalCrossing, verticalCrossing];
		const disjoint = [
			horizontalCrossing,
			relation('vertical', [
				{ x: 150, y: 0 },
				{ x: 150, y: 100 },
			]),
		];
		const cache = {};
		expect(validatedBridgesCached(crossing, cache)).toHaveLength(1);
		expect(validatedBridgesCached(disjoint, cache)).toEqual([]);
		expect(validatedBridgesCached(crossing, cache)).toHaveLength(1);
	});

	it('moves the bridge to the run that has room when the later one is crowded', () => {
		const short = relation('short', [
			{ x: 50, y: 45 },
			{ x: 50, y: 60 },
		]);
		expect(validatedBridges([horizontalCrossing, short])).toEqual([
			{ x: 50, y: 50, carrierIds: ['horizontal'], crossedIds: ['short'] },
		]);
	});

	it('never draws a bridge at a bend, a T-contact or a collinear overlap', () => {
		const bend = relation('bend', [
			{ x: 0, y: 50 },
			{ x: 50, y: 50 },
			{ x: 50, y: 150 },
		]);
		const stub = relation('stub', [
			{ x: 50, y: 0 },
			{ x: 50, y: 50 },
		]);
		const overlap = relation('overlap', [
			{ x: 20, y: 50 },
			{ x: 80, y: 50 },
		]);
		expect(validatedBridges([bend, stub])).toEqual([]);
		expect(validatedBridges([horizontalCrossing, overlap])).toEqual([]);
		expect(unbridgedContacts(bend, stub, [])).toEqual([
			{ kind: 'point', from: { x: 50, y: 50 }, to: { x: 50, y: 50 } },
		]);
		expect(unbridgedContacts(horizontalCrossing, overlap, [])).not.toEqual([]);
	});

	it('distinguishes attachment points from the entire overlap beginning at a port', () => {
		const stem = relation('stem', [
			{ x: 0, y: 0 },
			{ x: 50, y: 0 },
		]);
		const turn = relation('turn', [
			{ x: 0, y: 0 },
			{ x: 20, y: 0 },
			{ x: 20, y: 30 },
		]);
		const point = relation('point', [
			{ x: 0, y: 0 },
			{ x: 0, y: 30 },
		]);
		expect(unbridgedContacts(stem, turn, [])).toEqual([
			{ kind: 'overlap', from: { x: 0, y: 0 }, to: { x: 20, y: 0 } },
		]);
		expect(unbridgedContacts(stem, point, [])).toEqual([
			{ kind: 'point', from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
		]);
	});

	it('never bridges a crossing without the clearance on either run', () => {
		const shortHorizontal = relation('short-horizontal', [
			{ x: 40, y: 50 },
			{ x: 60, y: 50 },
		]);
		const shortVertical = relation('short-vertical', [
			{ x: 50, y: 40 },
			{ x: 50, y: 60 },
		]);
		expect(validatedBridges([shortHorizontal, shortVertical])).toEqual([]);
		expect(unbridgedContacts(shortHorizontal, shortVertical, [])).toEqual([
			{ kind: 'point', from: { x: 50, y: 50 }, to: { x: 50, y: 50 } },
		]);
		expect(
			unbridgedCrossings({
				crossings: strictCrossings([shortHorizontal, shortVertical]),
				bridges: [],
			}),
		).toHaveLength(1);
	});

	it('rejects a forged mark whose carrier does not pass through the point', () => {
		const forged: LayoutBridge = {
			x: 50,
			y: 50,
			carrierIds: ['foreign'],
			crossedIds: ['horizontal'],
		};
		expect(unbridgedContacts(horizontalCrossing, verticalCrossing, [forged])).toEqual([
			{ kind: 'point', from: { x: 50, y: 50 }, to: { x: 50, y: 50 } },
		]);
		const moved: LayoutBridge = {
			x: 50,
			y: 60,
			carrierIds: ['vertical'],
			crossedIds: ['horizontal'],
		};
		expect(unbridgedContacts(horizontalCrossing, verticalCrossing, [moved])).toEqual([
			{ kind: 'point', from: { x: 50, y: 50 }, to: { x: 50, y: 50 } },
		]);
	});

	it('accepts the oracle mark of a strict crossing', () => {
		const bridges = validatedBridges([horizontalCrossing, verticalCrossing]);
		expect(unbridgedContacts(horizontalCrossing, verticalCrossing, bridges)).toEqual([]);
	});

	it('places every bridge on a strict crossing with the declared clearances', () => {
		fc.assert(
			fc.property(routeSet(), (relations) => {
				const { bridges } = routeBridgeAnalysisIn(relations);
				const byId = new Map(relations.map((path) => [path.id, path]));
				const crossings = strictCrossings(relations);
				for (const bridge of bridges) {
					expect(bridge.carrierIds.length).toBeGreaterThan(0);
					expect(bridge.crossedIds.length).toBeGreaterThan(0);
					const crossing = crossings.find(
						(candidate) =>
							samePoint(candidate, bridge) &&
							covers(bridge, candidate, candidate.horizontalId, candidate.verticalId),
					);
					expect(crossing).toBeDefined();
					for (const id of [...bridge.carrierIds, ...bridge.crossedIds]) {
						const path = byId.get(id);
						if (path === undefined) throw new Error(`Unknown route ${id}`);
						expect(interiorRun(path, bridge)).toBeDefined();
					}
					for (const id of bridge.carrierIds) {
						const path = byId.get(id);
						if (path === undefined) throw new Error(`Unknown carrier ${id}`);
						const run = interiorRun(path, bridge);
						if (run === undefined) throw new Error('Missing carrier run');
						expect(clearance(run, bridge)).toBeGreaterThanOrEqual(12);
					}
				}
				for (const id of new Set(bridges.flatMap((bridge) => bridge.carrierIds))) {
					const path = byId.get(id);
					if (path === undefined) throw new Error(`Unknown carrier ${id}`);
					const placed = bridges
						.filter((bridge) => bridge.carrierIds.includes(id))
						.flatMap((bridge) => {
							const run = interiorRun(path, bridge);
							if (run === undefined) return [];
							return [{ run, bridge }];
						});
					for (const [index, first] of placed.entries())
						for (const second of placed.slice(index + 1)) {
							if (first.run !== second.run) continue;
							expect(
								Math.abs(clearance(first.run, first.bridge) - clearance(second.run, second.bridge)),
							).toBeGreaterThanOrEqual(18);
						}
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('matches exhaustive contact checks when bridges are indexed by their oracle point', () => {
		fc.assert(
			fc.property(routeSet(), (relations) => {
				const bridges = validatedBridges(relations);
				for (const [index, first] of relations.entries())
					for (const second of relations.slice(index + 1))
						expect(unbridgedContacts(first, second, bridges, { sortedByPoint: true })).toEqual(
							unbridgedContacts(first, second, bridges),
						);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('accepts a pair only when every contact is a bridged strict crossing', () => {
		fc.assert(
			fc.property(routeSet(), (relations) => {
				const { bridges } = routeBridgeAnalysisIn(relations);
				for (const [index, first] of relations.entries())
					for (const second of relations.slice(index + 1)) {
						const contacts = unbridgedContacts(first, second, []);
						if (contacts.length === 0) continue;
						const unbridged = unbridgedContacts(first, second, bridges);
						if (unbridged.length > 0) continue;
						for (const point of contacts) {
							expect(interiorRun(first, point.from)).toBeDefined();
							expect(interiorRun(second, point.from)).toBeDefined();
						}
					}
			}),
			PROPERTY_PARAMETERS,
		);
	});
});

/** Lattice routes over a coarse grid: contacts, overlaps and strict crossings are frequent. */
function routeSet(): fc.Arbitrary<readonly RoutedPath[]> {
	const coordinate = fc.integer({ min: 0, max: 3 }).map((value) => value * 50);
	const start = fc.tuple(coordinate, coordinate);
	const target = fc.tuple(coordinate, coordinate);
	const bent = fc.record({
		id: fc.constantFrom('first', 'second', 'third'),
		start,
		target,
		turned: fc.boolean(),
	});
	return fc.uniqueArray(bent, { selector: ({ id }) => id, maxLength: 3 }).map((routes) =>
		routes.map((route) => {
			const [startX, startY] = route.start;
			const [targetX, targetY] = route.target;
			let points: readonly Point[] = [
				{ x: startX, y: startY },
				{ x: startX, y: targetY },
				{ x: targetX, y: targetY },
			];
			if (route.turned)
				points = [
					{ x: startX, y: startY },
					{ x: targetX, y: startY },
					{ x: targetX, y: targetY },
				];
			return relation(route.id, points);
		}),
	);
}

/** Read through the public entry point: the property never inspects a private decision. */
function routeBridgeAnalysisIn(relations: readonly RoutedPath[]) {
	return {
		crossings: strictCrossings(relations),
		bridges: validatedBridges(relations),
	};
}
