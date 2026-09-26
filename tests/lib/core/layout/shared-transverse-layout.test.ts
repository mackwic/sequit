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
import { validateSharedLaneGeometry } from '../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import { transverseRouteSides } from '../../../../src/lib/core/layout/lanes/shared-transverse-sides';
import type { Point } from '../../../../src/lib/core/layout/layout-types';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

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
	] as const)('routes %s intra-lane dependencies outside their lane', (_label, from, to) => {
		const document = transverseDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'internal', from, to },
		]);
		const { result } = solve(document);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(result.layout.relations[0]?.points).toHaveLength(4);
	});

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

	it('validates a candidate with source before target on the cross axis', () => {
		const sides = transverseRouteSides({
			sourceLane: 0,
			targetLane: 0,
			source: { x: 10, y: 20, width: 80, height: 40 },
			target: { x: 130, y: 20, width: 80, height: 40 },
			vertical: true,
		});
		expect(sides).toEqual({ source: 1, target: 1 });
	});
});
