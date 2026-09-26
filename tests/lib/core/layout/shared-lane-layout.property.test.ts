import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { routeRuns, validatedBridges } from '../../../../src/lib/core/layout/bridge-oracle';
import { SHARED_LANE_CLEARANCE } from '../../../../src/lib/core/layout/shared-lane-frame';
import {
	type SharedLaneGeometry,
	validateSharedLaneGeometry,
} from '../../../../src/lib/core/layout/shared-lane-geometry';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/shared-lane-layout';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/shared-lane-model';
import { planSharedLanePorts } from '../../../../src/lib/core/layout/shared-lane-ports';
import {
	materializeParallelGeometry,
	parallelStrategyPlans,
} from '../../../../src/lib/core/layout/shared-lane-route-candidates';
import type { ParallelRouteAllocation } from '../../../../src/lib/core/layout/shared-lane-routing';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

const directions = [
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
] as const;
const edges = [
	{ id: 'e0', from: 'a1', to: 'b1' },
	{ id: 'e1', from: 'a1', to: 'b2' },
	{ id: 'e2', from: 'a2', to: 'b1' },
	{ id: 'e3', from: 'a2', to: 'b2' },
] as const;

function documentFor(mask: number, directionIndex: number, reverse: boolean): LogicDocument {
	const layout = directions[directionIndex] ?? directions[0];
	let relations = edges.filter((_, index) => (mask & (1 << index)) !== 0);
	if (reverse) relations = [...relations].reverse();
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'small-lane-layout',
		title: 'Small lane layout',
		layout,
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'A', label: 'A', layoutOrder: orderKey('a0') },
				{ id: 'B', label: 'B', layoutOrder: orderKey('a1') },
			],
		},
		natures: [{ id: 'task', label: 'Task', color: '#000000' }],
		groups: [],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'a1',
				natureId: 'task',
				laneId: 'A',
				markdown: 'A1',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 'a2',
				natureId: 'task',
				laneId: 'A',
				markdown: 'A2',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Node,
				id: 'b1',
				natureId: 'task',
				laneId: 'B',
				markdown: 'B1',
				layoutOrder: orderKey('a2'),
			},
			{
				kind: EndpointKind.Node,
				id: 'b2',
				natureId: 'task',
				laneId: 'B',
				markdown: 'B2',
				layoutOrder: orderKey('a3'),
			},
		],
		junctions: [],
		relations,
	};
}

function injections(
	ids: readonly string[],
	capacity: number,
): readonly ReadonlyMap<string, number>[] {
	const results: ReadonlyMap<string, number>[] = [];
	const assignment = new Map<string, number>();
	const used = new Set<number>();
	function visit(index: number): void {
		if (index === ids.length) {
			results.push(new Map(assignment));
			return;
		}
		const id = ids[index];
		if (id === undefined) throw new Error('Missing route identity.');
		for (let track = 0; track < capacity; track += 1) {
			if (used.has(track)) continue;
			used.add(track);
			assignment.set(id, track);
			visit(index + 1);
			assignment.delete(id);
			used.delete(track);
		}
	}
	visit(0);
	return results;
}

function metrics(geometry: SharedLaneGeometry) {
	let length = 0;
	let bends = 0;
	for (const route of geometry.relations) {
		for (let index = 1; index < route.points.length; index += 1) {
			const previous = route.points[index - 1];
			const current = route.points[index];
			if (previous === undefined || current === undefined) throw new Error('Missing route point.');
			length += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
		}
		bends += Math.max(0, routeRuns(route).length - 1);
	}
	return { bridges: validatedBridges(geometry.relations).length, length, bends };
}

function compare(left: ReturnType<typeof metrics>, right: ReturnType<typeof metrics>): number {
	return left.bridges - right.bridges || left.length - right.length || left.bends - right.bends;
}

function exhaustiveBest(
	prepared: ReturnType<typeof prepareLayoutDocument>,
): ReturnType<typeof metrics> | undefined {
	const routing = prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {});
	if (routing.input === undefined) return undefined;
	const input = routing.input;
	const ports = planSharedLanePorts(input);
	const plans = parallelStrategyPlans(input, ports, []);
	const bridgeFree: ReturnType<typeof metrics>[] = [];
	const bridged: ReturnType<typeof metrics>[] = [];
	for (const plan of plans) {
		const gutters = injections(
			input.plans.map(({ id }) => id).sort(),
			plan.allocation.gutter.edge.capacity,
		);
		const rails = injections(
			plan.frame.crossLanePlans.map(({ id }) => id).sort(),
			plan.allocation.exteriorRail.edge.capacity,
		);
		for (const gutter of gutters)
			for (const rail of rails) {
				const allocation: ParallelRouteAllocation = {
					gutter: { edge: plan.allocation.gutter.edge, trackByRelationId: gutter },
					exteriorRail: { edge: plan.allocation.exteriorRail.edge, trackByRelationId: rail },
					topExteriorRail: { edge: plan.allocation.topExteriorRail.edge, trackByRelationId: rail },
				};
				const geometry = materializeParallelGeometry(input, plan.frame, plan.order, allocation);
				const score = metrics(geometry);
				if (
					validateSharedLaneGeometry(prepared.graph, geometry, SHARED_LANE_CLEARANCE) === undefined
				)
					bridgeFree.push(score);
				if (
					validateSharedLaneGeometry(prepared.graph, geometry, SHARED_LANE_CLEARANCE, true) ===
					undefined
				)
					bridged.push(score);
			}
	}
	let candidates = bridged;
	if (bridgeFree.length > 0) candidates = bridgeFree;
	return [...candidates].sort(compare)[0];
}

const smallDocuments = fc
	.tuple(fc.integer({ min: 1, max: 15 }), fc.integer({ min: 0, max: 3 }), fc.boolean())
	.filter(([mask]) => {
		let count = 0;
		for (let bits = mask; bits > 0; bits &= bits - 1) count += 1;
		return count <= 2;
	});

describe('shared lane layout optimality property', () => {
	it('matches independent exhaustive assignments for small documents and relation permutations', () => {
		fc.assert(
			fc.property(smallDocuments, ([mask, directionIndex, reverse]) => {
				const document = documentFor(mask, directionIndex, reverse);
				const prepared = prepareLayoutDocument(document);
				const expected = exhaustiveBest(prepared);
				const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
				expect(expected).toBeDefined();
				expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
				if (expected === undefined || result.status !== SharedLaneLayoutStatus.Selected) return;
				expect(metrics(result.geometry)).toEqual(expected);

				const permuted = prepareLayoutDocument(documentFor(mask, directionIndex, !reverse));
				const permutedResult = solveSharedLaneLayout(
					permuted.graph,
					permuted.ranks,
					permuted.measurements,
				);
				expect(permutedResult).toEqual(result);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
