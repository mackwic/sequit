import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	type LogicRelation,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import {
	longEnd,
	longitudinal,
	longStart,
} from '../../../../src/lib/core/layout/geometry/shared-lane-geometry-primitives';
import {
	type SharedLaneGeometry,
	validateSharedLaneGeometry,
} from '../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import { verticalDirection } from '../../../../src/lib/core/layout/lanes/shared-lane-model';
import { transverseRouteSides } from '../../../../src/lib/core/layout/lanes/shared-transverse-sides';
import type { Bounds, Point } from '../../../../src/lib/core/layout/layout-types';
import { contains, prepareLayoutDocument } from '../../../support/harnesses/layout';
import { laneRowsDocument } from './shared-lane-rows-fixture';

const DIRECTIONS = [
	[LayoutDirection.TopToBottom, LayoutBias.Top],
	[LayoutDirection.BottomToTop, LayoutBias.Bottom],
	[LayoutDirection.LeftToRight, LayoutBias.Left],
	[LayoutDirection.RightToLeft, LayoutBias.Right],
] as const;

function transverseDocument(
	direction: LayoutDirection,
	bias: LayoutBias,
	relations: readonly LogicRelation[],
	laneCount = 3,
): LogicDocument {
	const laneIds = ['A', 'B', 'C'].slice(0, laneCount);
	const nodes: LogicDocument['nodes'][number][] = [
		{
			kind: EndpointKind.Node,
			id: 'a1',
			natureId: 'task',
			markdown: 'A1',
			laneId: 'A',
			layoutOrder: orderKey('a0'),
		},
		{
			kind: EndpointKind.Node,
			id: 'a2',
			natureId: 'task',
			markdown: 'A2',
			laneId: 'A',
			layoutOrder: orderKey('a1'),
		},
		{
			kind: EndpointKind.Node,
			id: 'b1',
			natureId: 'task',
			markdown: 'B1',
			laneId: 'B',
			layoutOrder: orderKey('a2'),
		},
	];
	if (laneCount === 3)
		nodes.push({
			kind: EndpointKind.Node,
			id: 'c1',
			natureId: 'task',
			markdown: 'C1',
			laneId: 'C',
			layoutOrder: orderKey('a3'),
		});
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'transverse-document',
		title: 'Transverse document',
		layout: defined(layoutConfiguration(direction, bias)),
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Transverse,
			growth: LaneGrowth.Auto,
			lanes: laneIds.map((id, index) => ({ id, label: id, layoutOrder: orderKey(`a${index}`) })),
		},
		natures: [{ id: 'task', label: 'Task', color: '#000000' }],
		groups: [],
		nodes,
		junctions: [],
		relations,
	};
}

function solve(document: LogicDocument) {
	const prepared = prepareLayoutDocument(document);
	return {
		prepared,
		result: solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements),
	};
}

function shifted(points: readonly Point[], index: number, axis: 'x' | 'y', delta: number): Point[] {
	const changed = [...points];
	const original = defined(changed[index]);
	changed[index] = { ...original, [axis]: original[axis] + delta };
	return changed;
}

function routeLength(points: readonly Point[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		const previous = defined(points[index - 1]);
		const current = defined(points[index]);
		length += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
	}
	return length;
}

/** A route that never turns back: its length is the Manhattan distance between its ends. */
function monotone(points: readonly Point[]): boolean {
	const start = defined(points[0]);
	const end = defined(points.at(-1));
	return routeLength(points) === Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
}

function insideBounds(bounds: Bounds, points: readonly Point[]): boolean {
	return points.every((point) => contains(bounds, { ...point, width: 0, height: 0 }));
}

/** The free distance between two boxes along the rank axis. */
function rankGap(first: Bounds, second: Bounds, vertical: boolean): number {
	return Math.max(
		longStart(second, vertical) - longEnd(first, vertical),
		longStart(first, vertical) - longEnd(second, vertical),
	);
}

/** An L-03 witness: transverse tasks listed with their lane, then child → parent pairs. */
function selectedWitness(
	direction: LayoutDirection,
	lanes: readonly string[],
	nodes: readonly (readonly [string, string])[],
	relations: readonly (readonly [string, string])[],
) {
	const configuration = defined(DIRECTIONS.find(([candidate]) => candidate === direction));
	const prepared = prepareLayoutDocument(
		laneRowsDocument({
			direction: configuration,
			orientation: LaneOrientation.Transverse,
			lanes,
			nodes,
			relations,
		}),
	);
	const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
	if (result.status !== SharedLaneLayoutStatus.Selected) throw new Error(JSON.stringify(result));
	expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
	return {
		layout: result.layout,
		bounds: new Map(result.layout.elements.map(({ id, bounds }) => [id, bounds])),
		routes: new Map(result.layout.relations.map(({ id, points }) => [id, points])),
		vertical: verticalDirection(direction),
	};
}

describe('transverse shared lane layout', () => {
	it.each(DIRECTIONS)(
		'routes across A|B|C around a middle-lane obstacle in %s',
		(direction, bias) => {
			const source = transverseDocument(direction, bias, [{ id: 'a-to-c', from: 'a1', to: 'c1' }]);
			const document: LogicDocument = {
				...source,
				groups: [
					{
						kind: EndpointKind.Group,
						id: 'obstacle',
						label: 'Obstacle',
						laneId: 'B',
						layoutOrder: orderKey('a4'),
					},
				],
			};
			const { prepared, result } = solve(document);
			expect(result.status, JSON.stringify(result)).toBe(SharedLaneLayoutStatus.Selected);
			if (result.status !== SharedLaneLayoutStatus.Selected) return;
			expect(result.layout.lanes?.map(({ id }) => id)).toEqual(['A', 'B', 'C']);
			expect(result.layout.relations[0]?.points).toHaveLength(6);
			expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
		},
	);

	it.each(DIRECTIONS)('routes A→B in two transverse lanes in %s', (direction, bias) => {
		const document = transverseDocument(
			direction,
			bias,
			[{ id: 'a-to-b', from: 'a1', to: 'b1' }],
			2,
		);
		const { result } = solve(document);
		expect(result.status, JSON.stringify(result)).toBe(SharedLaneLayoutStatus.Selected);
	});

	it.each([
		['forward', 'a1', 'c1'],
		['backward', 'c1', 'a1'],
	] as const)('supports %s inter-lane dependencies', (_label, from, to) => {
		const document = transverseDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'cross', from, to },
		]);
		expect(solve(document).result.status).toBe(SharedLaneLayoutStatus.Selected);
	});

	it.each([
		['forward', 'a1', 'a2'],
		['backward', 'a2', 'a1'],
	] as const)('joins the facing faces of %s intra-lane dependencies', (_label, from, to) => {
		const document = transverseDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'internal', from, to },
		]);
		const { result } = solve(document);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		const points = defined(result.layout.relations[0]).points;
		expect(points).toHaveLength(4);
		expect(monotone(points)).toBe(true);
		const lane = defined(result.layout.lanes?.find(({ id }) => id === 'A')).bounds;
		expect(insideBounds(lane, points)).toBe(true);
	});

	it.each(DIRECTIONS)(
		'joins two adjacent lanes by one segment between aligned facing faces in %s',
		(direction) => {
			const { bounds, routes, vertical } = selectedWitness(
				direction,
				['L1', 'L2'],
				[
					['n0', 'L1'],
					['n1', 'L2'],
				],
				[['n1', 'n0']],
			);
			const points = defined(routes.get('n1-n0'));
			expect(points).toHaveLength(2);
			expect(routeLength(points)).toBe(
				rankGap(defined(bounds.get('n0')), defined(bounds.get('n1')), vertical),
			);
		},
	);

	it.each(DIRECTIONS)('fans B under A into a1 without any crossing in %s', (direction) => {
		const { layout, routes } = selectedWitness(
			direction,
			['A', 'B'],
			[
				['a1', 'A'],
				['b1', 'B'],
				['b2', 'B'],
				['b3', 'B'],
			],
			[
				['b1', 'a1'],
				['b2', 'a1'],
				['b3', 'a1'],
			],
		);
		expect(routeBridgeAnalysis(layout.relations).crossings).toHaveLength(0);
		// b2 sits exactly under a1, so its central port faces a1's.
		expect(routes.get('b2-a1')).toHaveLength(2);
		for (const points of routes.values()) {
			expect(points.length).toBeLessThanOrEqual(4);
			expect(monotone(points)).toBe(true);
		}
	});

	it.each(DIRECTIONS)('chains rows of one lane through their facing faces in %s', (direction) => {
		const { layout, bounds, routes, vertical } = selectedWitness(
			direction,
			['A', 'B'],
			[
				['a1', 'A'],
				['a2', 'A'],
				['a3', 'A'],
				['b1', 'B'],
			],
			[
				['a2', 'a1'],
				['a3', 'a2'],
			],
		);
		const lane = defined(layout.lanes?.find(({ id }) => id === 'A')).bounds;
		for (const [child, parent] of [
			['a2', 'a1'],
			['a3', 'a2'],
		] as const) {
			const points = defined(routes.get(`${child}-${parent}`));
			expect(points).toHaveLength(4);
			expect(monotone(points)).toBe(true);
			expect(insideBounds(lane, points)).toBe(true);
			// Leaving and entering the facing faces spans exactly the gap between the two rows.
			const travelled =
				longitudinal(defined(points.at(-1)), vertical) - longitudinal(defined(points[0]), vertical);
			expect(Math.abs(travelled)).toBe(
				rankGap(defined(bounds.get(child)), defined(bounds.get(parent)), vertical),
			);
		}
	});

	it.each(DIRECTIONS)(
		'keeps the bridge-free U arc when a facing local leg would cross a lane message in %s',
		(direction) => {
			// Review witness: the facing leg of n6→n2 would cross n5→n3; the historical arc does not.
			const { layout } = selectedWitness(
				direction,
				['L0', 'L1'],
				[
					['n2', 'L0'],
					['n3', 'L0'],
					['n5', 'L1'],
					['n6', 'L0'],
				],
				[
					['n5', 'n3'],
					['n6', 'n2'],
				],
			);
			expect(routeBridgeAnalysis(layout.relations).crossings).toHaveLength(0);
		},
	);

	it('routes linked dependencies in document lane order', () => {
		const document = transverseDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'a-to-b', from: 'a1', to: 'b1' },
			{ id: 'b-to-c', from: 'b1', to: 'c1' },
		]);
		const { result } = solve(document);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(result.layout.relations.map(({ id }) => id)).toEqual(['a-to-b', 'b-to-c']);
	});

	it('keeps transverse lane geometry invariant under relation ID renaming', () => {
		const document = transverseDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'z-route', from: 'a1', to: 'c1' },
			{ id: 'a-route', from: 'a2', to: 'c1' },
		]);
		const renamedDocument: LogicDocument = {
			...document,
			relations: document.relations.map((relation, index) => {
				let id = 'z-route';
				if (index === 0) id = 'a-route';
				return { ...relation, id };
			}),
		};
		const original = solve(document).result;
		const renamed = solve(renamedDocument).result;
		expect(original.status).toBe(SharedLaneLayoutStatus.Selected);
		expect(renamed.status).toBe(SharedLaneLayoutStatus.Selected);
		if (
			original.status !== SharedLaneLayoutStatus.Selected ||
			renamed.status !== SharedLaneLayoutStatus.Selected
		)
			return;
		const geometryWithoutRelationIds = (geometry: SharedLaneGeometry) => ({
			width: geometry.width,
			height: geometry.height,
			lanes: geometry.lanes,
			elements: geometry.elements,
			relations: geometry.relations.map(({ from, to, points }) => ({ from, to, points })),
		});
		expect(geometryWithoutRelationIds(renamed.geometry)).toEqual(
			geometryWithoutRelationIds(original.geometry),
		);
	});

	it('keeps output deterministic under input permutation and grows a lane with content', () => {
		const document = transverseDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'a-to-c', from: 'a1', to: 'c1' },
		]);
		const reordered: LogicDocument = {
			...document,
			presentation: {
				...defined(document.presentation),
				lanes: [...defined(document.presentation).lanes].reverse(),
			},
			nodes: [...document.nodes].reverse(),
		};
		expect(solve(reordered).result).toEqual(solve(document).result);
		const prepared = prepareLayoutDocument(document, {
			nodes: { a1: { width: 500, height: 116 } },
		});
		const enlarged = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		const baseline = solve(document).result;
		expect(enlarged.status).toBe(SharedLaneLayoutStatus.Selected);
		if (enlarged.status !== SharedLaneLayoutStatus.Selected) return;
		if (baseline.status !== SharedLaneLayoutStatus.Selected) return;
		expect(enlarged.layout.width).toBeGreaterThan(baseline.layout.width);
	});

	it.each([
		['empty route', () => [], 'is empty'],
		[
			'sparse tail',
			(points: readonly Point[]) => {
				const sparse = new Array<Point>(3);
				sparse[0] = defined(points[0]);
				sparse[1] = defined(points[1]);
				return sparse;
			},
			'is empty',
		],
		['source face', (points: readonly Point[]) => shifted(points, 0, 'y', 1), 'wrong source face'],
		['target face', (points: readonly Point[]) => shifted(points, 5, 'y', 1), 'wrong target face'],
		[
			'source departure',
			(points: readonly Point[]) => shifted(points, 1, 'x', 1),
			'leaves the source inward',
		],
		[
			'target approach',
			(points: readonly Point[]) => shifted(points, 4, 'x', 1),
			'reaches the target from inside',
		],
	] as const)('independent validator rejects %s', (_name, mutate, expected) => {
		const document = transverseDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'a-to-c', from: 'a1', to: 'c1' },
		]);
		const { prepared, result } = solve(document);
		if (result.status !== SharedLaneLayoutStatus.Selected)
			throw new Error('Expected selected witness');
		const route = defined(result.geometry.relations[0]);
		const altered = {
			...result.geometry,
			relations: [{ ...route, points: mutate(route.points) }],
		};
		expect(validateSharedLaneGeometry(prepared.graph, altered)).toContain(expected);
	});

	it('validates endpoints of one row on the faces turned to each other on the cross axis', () => {
		const sides = transverseRouteSides({
			sourceLane: 0,
			targetLane: 0,
			source: { x: 10, y: 20, width: 80, height: 40 },
			target: { x: 130, y: 20, width: 80, height: 40 },
			vertical: true,
		});
		expect(sides).toEqual({ source: 1, target: 1 });
	});

	it.each([
		['a later', { x: 130, y: 100 }, { source: -1, target: 1, arcTarget: -1 }],
		['an earlier', { x: -110, y: -60 }, { source: 1, target: -1, arcTarget: 1 }],
	] as const)(
		'validates a source on %s row on the facing faces or the U arc',
		(_row, at, faces) => {
			const target = { x: 10, y: 20, width: 80, height: 40 };
			const source = { ...target, ...at };
			expect(
				transverseRouteSides({ sourceLane: 0, targetLane: 0, source, target, vertical: true }),
			).toEqual(faces);
		},
	);
});
