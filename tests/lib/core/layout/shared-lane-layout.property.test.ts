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
import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { routeRuns } from '../../../../src/lib/core/layout/bridges/route-runs';
import { SHARED_LANE_CLEARANCE } from '../../../../src/lib/core/layout/lanes/shared-lane-frame';
import {
	type SharedLaneGeometry,
	validateSharedLaneGeometry,
} from '../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import {
	type SharedLaneLayoutOutcome,
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/lanes/shared-lane-model';
import { planSharedLanePorts } from '../../../../src/lib/core/layout/lanes/shared-lane-ports';
import {
	materializeParallelGeometry,
	parallelStrategyPlans,
} from '../../../../src/lib/core/layout/lanes/shared-lane-route-candidates';
import type { ParallelRouteAllocation } from '../../../../src/lib/core/layout/lanes/shared-lane-routing';
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
					gutter: { edge: plan.allocation.gutter.edge, trackByKey: gutter },
					exteriorRail: { edge: plan.allocation.exteriorRail.edge, trackByKey: rail },
					topExteriorRail: { edge: plan.allocation.topExteriorRail.edge, trackByKey: rail },
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

const relationIdPermutationCases = smallDocuments.chain((value) => {
	const [mask, directionIndex, reverse] = value;
	const document = documentFor(mask, directionIndex, reverse);
	const indices = document.relations.map((_relation, index) => index);
	return fc
		.shuffledSubarray(indices, {
			minLength: indices.length,
			maxLength: indices.length,
		})
		.map((permutation) => ({ value, permutation }));
});

function outcomeByOriginalRelationId(
	outcome: SharedLaneLayoutOutcome,
	originalIdByCurrentId: ReadonlyMap<string, string>,
) {
	if (outcome.status !== SharedLaneLayoutStatus.Selected) {
		let reason = outcome.reason;
		const substitutions = [...originalIdByCurrentId.entries()];
		for (const [index, [currentId]] of substitutions.entries())
			reason = reason.replaceAll(currentId, `\u0000${index}\u0000`);
		for (const [index, [, originalId]] of substitutions.entries())
			reason = reason.replaceAll(`\u0000${index}\u0000`, originalId);
		return { status: outcome.status, reason };
	}
	const routesByOriginalId = new Map(
		outcome.geometry.relations.map(({ id, ...route }) => {
			const originalId = originalIdByCurrentId.get(id);
			if (originalId === undefined) throw new Error(`Missing original relation ID for ${id}.`);
			return [originalId, route] as const;
		}),
	);
	const relationIds = [...originalIdByCurrentId.values()];
	return {
		status: outcome.status,
		width: outcome.geometry.width,
		height: outcome.geometry.height,
		lanes: outcome.geometry.lanes,
		elements: outcome.geometry.elements,
		routes: relationIds.map((id) => [id, routesByOriginalId.get(id)] as const),
	};
}

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

	it('preserves lane geometry under relation ID permutations', () => {
		fc.assert(
			fc.property(relationIdPermutationCases, ({ value, permutation }) => {
				const [mask, directionIndex, reverse] = value;
				const document = documentFor(mask, directionIndex, reverse);
				const originalIds = document.relations.map(({ id }) => id);
				const renamedRelations = document.relations.map((relation, index) => {
					const assignedIndex = permutation[index];
					if (assignedIndex === undefined) throw new Error('Missing a relation permutation index.');
					const id = originalIds[assignedIndex];
					if (id === undefined) throw new Error('Missing the permuted relation ID.');
					return { ...relation, id };
				});
				const renamedDocument: LogicDocument = { ...document, relations: renamedRelations };
				const originalPrepared = prepareLayoutDocument(document);
				const renamedPrepared = prepareLayoutDocument(renamedDocument);
				const original = solveSharedLaneLayout(
					originalPrepared.graph,
					originalPrepared.ranks,
					originalPrepared.measurements,
				);
				const renamed = solveSharedLaneLayout(
					renamedPrepared.graph,
					renamedPrepared.ranks,
					renamedPrepared.measurements,
				);
				const originalIdByRenamedId = new Map(
					renamedRelations.map((relation, index) => {
						const originalId = originalIds[index];
						if (originalId === undefined) throw new Error('Missing the original relation ID.');
						return [relation.id, originalId] as const;
					}),
				);
				const identity = new Map(originalIds.map((id) => [id, id] as const));
				expect(outcomeByOriginalRelationId(renamed, originalIdByRenamedId)).toEqual(
					outcomeByOriginalRelationId(original, identity),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
