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
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { makeSharedLaneFrame } from '../../../../src/lib/core/layout/shared-lane-frame';
import { validateSharedLaneGeometry } from '../../../../src/lib/core/layout/shared-lane-geometry';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/shared-lane-layout';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/shared-lane-model';
import { planSharedLanePorts } from '../../../../src/lib/core/layout/shared-lane-ports';
import {
	allocateParallelRoutes,
	ParallelRouteOrder,
	routeSharedLanes,
} from '../../../../src/lib/core/layout/shared-lane-routing';
import { makeTransverseLaneFrame } from '../../../../src/lib/core/layout/shared-transverse-frame';
import {
	allocateTransverseRoutes,
	routeTransverseLanes,
	TransverseRouteOrder,
} from '../../../../src/lib/core/layout/shared-transverse-routing';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

const DIRECTIONS = [
	[LayoutDirection.TopToBottom, LayoutBias.Top],
	[LayoutDirection.BottomToTop, LayoutBias.Bottom],
	[LayoutDirection.LeftToRight, LayoutBias.Left],
	[LayoutDirection.RightToLeft, LayoutBias.Right],
] as const;

function processDocument(
	direction: LayoutDirection,
	bias: LayoutBias,
	orientation: LaneOrientation = LaneOrientation.Transverse,
): LogicDocument {
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'process-s-sd-c',
		title: 'S | SD | C',
		layout: defined(layoutConfiguration(direction, bias)),
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: orientation,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'S', label: 'S', layoutOrder: orderKey('a0') },
				{ id: 'SD', label: 'SD', layoutOrder: orderKey('a1') },
				{ id: 'C', label: 'C', layoutOrder: orderKey('a2') },
			],
		},
		natures: [{ id: 'task', label: 'Task', color: '#000000' }],
		groups: [],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'c-request',
				natureId: 'task',
				laneId: 'C',
				markdown: 'Request',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 's-receive',
				natureId: 'task',
				laneId: 'S',
				markdown: 'Receive',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Node,
				id: 'sd-work',
				natureId: 'task',
				laneId: 'SD',
				markdown: 'Work',
				layoutOrder: orderKey('a2'),
			},
			{
				kind: EndpointKind.Node,
				id: 's-reply',
				natureId: 'task',
				laneId: 'S',
				markdown: 'Reply',
				layoutOrder: orderKey('a3'),
			},
			{
				kind: EndpointKind.Node,
				id: 'c-done',
				natureId: 'task',
				laneId: 'C',
				markdown: 'Done',
				layoutOrder: orderKey('a4'),
			},
		],
		junctions: [],
		relations: [
			{ id: 'request', from: 'c-request', to: 's-receive' },
			{ id: 'dispatch', from: 's-receive', to: 'sd-work' },
			{ id: 'completion', from: 'sd-work', to: 's-reply' },
			{ id: 'response', from: 's-reply', to: 'c-done' },
		],
	};
}

describe('S | SD | C shared process', () => {
	it.each(DIRECTIONS)('classifies each C↔S and S↔SD dependency in %s', (direction, bias) => {
		const source = processDocument(direction, bias);
		for (const relation of source.relations) {
			const prepared = prepareLayoutDocument({ ...source, relations: [relation] });
			const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
			expect(result.status, `${relation.id}: ${JSON.stringify(result)}`).toBe(
				SharedLaneLayoutStatus.Selected,
			);
		}
	});

	it.each(DIRECTIONS)('classifies the full C→S→SD→S→C process in %s', (direction, bias) => {
		const prepared = prepareLayoutDocument(processDocument(direction, bias));
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status, JSON.stringify(result)).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(result.layout.relations).toHaveLength(4);
		expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
	});

	it('preserves pre-refactor canonical geometry for the four-message crossing', () => {
		const prepared = prepareLayoutDocument(
			processDocument(LayoutDirection.TopToBottom, LayoutBias.Top),
		);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		const ports = planSharedLanePorts(input);
		const frame = makeTransverseLaneFrame(input, ports);
		const dimensions = { width: frame.crossExtent, height: frame.longExtent };
		const base = { ...dimensions, lanes: frame.lanes, elements: frame.elements };
		const canonical = {
			...base,
			relations: routeTransverseLanes(
				input,
				frame,
				allocateTransverseRoutes(input, frame, TransverseRouteOrder.Canonical),
				TransverseRouteOrder.Canonical,
			),
		};
		expect(canonical.relations.map(({ id, points }) => ({ id, points }))).toEqual([
			{
				id: 'completion',
				points: [
					{ x: 416, y: 648 },
					{ x: 416, y: 588 },
					{ x: 136, y: 588 },
					{ x: 136, y: 372 },
					{ x: 330, y: 372 },
					{ x: 330, y: 312 },
				],
			},
			{
				id: 'dispatch',
				points: [
					{ x: 550, y: 312 },
					{ x: 550, y: 396 },
					{ x: 768, y: 396 },
					{ x: 768, y: 564 },
					{ x: 464, y: 564 },
					{ x: 464, y: 648 },
				],
			},
			{
				id: 'request',
				points: [
					{ x: 574, y: 1100 },
					{ x: 574, y: 992 },
					{ x: 88, y: 992 },
					{ x: 88, y: 420 },
					{ x: 598, y: 420 },
					{ x: 598, y: 312 },
				],
			},
			{
				id: 'response',
				points: [
					{ x: 282, y: 312 },
					{ x: 282, y: 444 },
					{ x: 816, y: 444 },
					{ x: 816, y: 968 },
					{ x: 306, y: 968 },
					{ x: 306, y: 1100 },
				],
			},
		]);
		const nested = {
			...base,
			relations: routeTransverseLanes(
				input,
				frame,
				allocateTransverseRoutes(input, frame, TransverseRouteOrder.Nested),
				TransverseRouteOrder.Nested,
			),
		};
		expect(validateSharedLaneGeometry(prepared.graph, canonical)).toContain(
			'cross without a bridge',
		);
		expect(validateSharedLaneGeometry(prepared.graph, nested)).toBeUndefined();
		const selected = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		expect(selected.geometry.relations).toEqual(nested.relations);
		expect(selected.allocationWitness?.passes).toEqual([
			{
				acceptBridges: false,
				attempted: 2,
				total: '2',
				exhaustive: true,
				truncated: false,
				searchStarted: true,
			},
		]);
	});

	it.each(DIRECTIONS)(
		'keeps both orientations deterministic under collection permutations in %s',
		(direction, bias) => {
			for (const orientation of [LaneOrientation.Parallel, LaneOrientation.Transverse]) {
				const source = processDocument(direction, bias, orientation);
				const permuted: LogicDocument = {
					...source,
					presentation: {
						...defined(source.presentation),
						lanes: [...defined(source.presentation).lanes].reverse(),
					},
					nodes: [...source.nodes].reverse(),
					relations: [...source.relations].reverse(),
				};
				const first = prepareLayoutDocument(source);
				const second = prepareLayoutDocument(permuted);
				const baseline = solveSharedLaneLayout(first.graph, first.ranks, first.measurements);
				const reordered = solveSharedLaneLayout(second.graph, second.ranks, second.measurements);
				expect(baseline.status).toBe(SharedLaneLayoutStatus.Selected);
				expect(reordered).toEqual(baseline);
			}
		},
	);

	it.each(DIRECTIONS)('classifies the full process in parallel lanes in %s', (direction, bias) => {
		const prepared = prepareLayoutDocument(
			processDocument(direction, bias, LaneOrientation.Parallel),
		);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status, JSON.stringify(result)).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
	});

	it('resolves the parallel crossing through local adjacent passages and exterior rails', () => {
		const prepared = prepareLayoutDocument(
			processDocument(LayoutDirection.TopToBottom, LayoutBias.Top, LaneOrientation.Parallel),
		);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		const ports = planSharedLanePorts(input);
		const canonicalFrame = makeSharedLaneFrame(input, ports);
		const canonical = {
			width: canonicalFrame.crossExtent,
			height: canonicalFrame.longExtent,
			lanes: canonicalFrame.lanes,
			elements: canonicalFrame.elements,
			relations: routeSharedLanes(
				input,
				canonicalFrame,
				allocateParallelRoutes(input, canonicalFrame),
			),
		};
		expect(validateSharedLaneGeometry(prepared.graph, canonical)).toContain(
			'cross without a bridge',
		);
		const localFrame = makeSharedLaneFrame(input, ports, true);
		const local = {
			width: localFrame.crossExtent,
			height: localFrame.longExtent,
			lanes: localFrame.lanes,
			elements: localFrame.elements,
			relations: routeSharedLanes(
				input,
				localFrame,
				allocateParallelRoutes(input, localFrame),
				ParallelRouteOrder.LocalPassages,
			),
		};
		expect(validateSharedLaneGeometry(prepared.graph, local)).toBeUndefined();
	});

	it.each(DIRECTIONS)(
		'validates both orientations with heterogeneous measurements and renamed relations in %s',
		(direction, bias) => {
			const relationIds = new Map([
				['request', 'a-request'],
				['dispatch', 'z-dispatch'],
				['completion', 'y-completion'],
				['response', 'b-response'],
			]);
			for (const orientation of [LaneOrientation.Parallel, LaneOrientation.Transverse]) {
				const source = processDocument(direction, bias, orientation);
				const renamed: LogicDocument = {
					...source,
					relations: source.relations.map((relation) => ({
						...relation,
						id: defined(relationIds.get(relation.id)),
					})),
				};
				const prepared = prepareLayoutDocument(renamed, {
					nodes: {
						'c-request': { width: 344, height: 148 },
						's-receive': { width: 300, height: 100 },
						'sd-work': { width: 248, height: 172 },
						's-reply': { width: 420, height: 128 },
						'c-done': { width: 260, height: 160 },
					},
				});
				const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
				expect(result.status, `${orientation}: ${JSON.stringify(result)}`).toBe(
					SharedLaneLayoutStatus.Selected,
				);
				if (result.status !== SharedLaneLayoutStatus.Selected) continue;
				expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
			}
		},
	);
});
