import { describe, expect, it } from 'vitest';

import { applyLayoutPerformanceInsertion } from '../../../../src/app/workshop/fixtures/layout-performance/apply-layout-performance-insertion';
import { LayoutPerformanceScenarioBuilder } from '../../../../src/app/workshop/fixtures/layout-performance/layout-performance-scenario-builder';
import { LAYOUT_PERFORMANCE_SCENARIO_NAMES } from '../../../../src/app/workshop/fixtures/layout-performance/scenario-name';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../../src/app/workshop/fixtures/layout-performance/scenarios';
import {
	EndpointKind,
	LaneOrientation,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { SHARED_LANE_CLEARANCE } from '../../../../src/lib/core/layout/lanes/shared-lane-frame';
import { validateSharedLaneGeometry } from '../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import { evaluateDedicatedLayout } from '../../../../src/lib/core/layout/layout-engine';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import {
	buildPreparedScenarioTwice,
	layoutPreparedScenario,
	scenarioDocumentIsValid,
} from '../../../support/harnesses/layout-performance-scenario';
import { prepareLayoutPerformanceScenario } from '../../../support/scenarios/layout-performance/prepare-layout-performance-scenario';

const nodeCounts = [1, 10, 19, 50] as const;

class RelationReplacementBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'long-queue' as const;

	protected insertNode(nodeIndex: number) {
		if (nodeIndex === 1) {
			const parent = this.nodeId(0);
			const child = this.nodeId(1);
			const relation = this.childToParent(parent, child);
			return this.insertion(nodeIndex, nodeIndex, {
				addedRelations: [
					{ ...relation, id: 'retained-relation' },
					{ ...relation, id: 'removed-relation' },
				],
			});
		}

		if (nodeIndex === 2) {
			return this.insertion(nodeIndex, nodeIndex, {
				addedRelations: [this.childToParent(this.nodeId(1), this.nodeId(2))],
				removedRelationIds: ['removed-relation'],
			});
		}

		return this.insertion(nodeIndex, nodeIndex);
	}
}

class DuplicateEntityBuilder extends LayoutPerformanceScenarioBuilder {
	readonly name = 'long-queue' as const;

	protected insertNode(nodeIndex: number) {
		if (nodeIndex !== 0) return this.insertion(nodeIndex, nodeIndex);
		return this.insertion(nodeIndex, nodeIndex, {
			groups: [{ ...this.group(nodeIndex), id: this.nodeId(nodeIndex) }],
		});
	}
}

describe('layout performance scenario contracts', () => {
	describe('incremental builder identity and removal behavior', () => {
		it('removes selected relations while preserving the others', () => {
			const snapshot = new RelationReplacementBuilder().buildSnapshot(3);

			expect(snapshot.document.relations.map(({ id }) => id)).toEqual([
				'retained-relation',
				'relation-node-0000000000000001-to-node-0000000000000002',
			]);
		});

		it('rejects duplicate entity IDs within one insertion', () => {
			expect(() => new DuplicateEntityBuilder().buildSnapshot(1)).toThrow('Duplicate insertion id');
		});
	});

	it('registers every scenario exactly once and in canonical order', () => {
		expect(LAYOUT_PERFORMANCE_SCENARIOS.map(({ name }) => name)).toEqual(
			LAYOUT_PERFORMANCE_SCENARIO_NAMES,
		);
		expect(new Set(LAYOUT_PERFORMANCE_SCENARIOS.map(({ name }) => name)).size).toBe(
			LAYOUT_PERFORMANCE_SCENARIO_NAMES.length,
		);
	});

	it('includes a four-route shared-lane allocation stress scenario', async () => {
		const scenario = LAYOUT_PERFORMANCE_SCENARIOS.find(
			(candidate) => candidate.name === 'lane-allocations',
		);
		if (scenario === undefined) throw new Error('Lane allocation performance scenario is missing');
		const snapshot = scenario.createBuilder().buildSnapshot(10);
		const validation = validateLogicDocument(snapshot.document);
		expect(validation.ok, JSON.stringify(validation)).toBe(true);
		const presentation = snapshot.document.presentation;
		if (presentation === undefined)
			throw new Error('Lane performance fixture is missing its root presentation');
		expect(presentation.policy).toBe(LayoutPolicy.Layered);
		expect(presentation.laneOrientation).toBe(LaneOrientation.Parallel);
		expect(presentation.lanes.map(({ id }) => id)).toEqual(['A', 'B', 'C']);
		expect(snapshot.document.nodes.filter(({ laneId }) => laneId !== 'C')).toHaveLength(4);
		expect(snapshot.document.nodes.filter(({ laneId }) => laneId === 'C')).toHaveLength(6);
		expect(snapshot.document.relations).toHaveLength(4);
		expect(snapshot.metadata).toMatchObject({ laneCount: 3, routeCount: 4 });
		const prepared = prepareLayoutPerformanceScenario(scenario, 10);
		const layout = await layoutPreparedScenario(prepared);
		expect(layout.relations.map(({ id }) => id).sort()).toEqual(
			snapshot.document.relations.map(({ id }) => id).sort(),
		);
	});

	it('grows relations across all three lanes while validating bounded route work', () => {
		const scenario = LAYOUT_PERFORMANCE_SCENARIOS.find(
			({ name }) => name === 'lane-allocations-dense',
		);
		if (scenario === undefined) throw new Error('Growing lane performance profile is missing');
		const small = scenario.createBuilder().buildSnapshot(50);
		const large = prepareLayoutPerformanceScenario(scenario, 1000);
		expect(small.document.relations).toHaveLength(3);
		expect(large.document.relations).toHaveLength(50);
		expect(new Set(large.document.nodes.map(({ laneId }) => laneId))).toEqual(
			new Set(['A', 'B', 'C']),
		);
		const lanesByNodeId = new Map(large.document.nodes.map(({ id, laneId }) => [id, laneId]));
		expect(new Set(large.document.relations.map(({ to }) => lanesByNodeId.get(to)))).toEqual(
			new Set(['A', 'B', 'C']),
		);
		const outcome = solveSharedLaneLayout(large.graph, large.ranks, large.measurements);
		expect(outcome.status).toBe(SharedLaneLayoutStatus.Selected);
		if (outcome.status !== SharedLaneLayoutStatus.Selected) return;
		expect(
			validateSharedLaneGeometry(large.graph, outcome.geometry, SHARED_LANE_CLEARANCE, true),
		).toBeUndefined();
		const passes = outcome.allocationWitness?.passes;
		expect(passes?.map(({ acceptBridges }) => acceptBridges)).toEqual([false, true]);
		expect(
			passes?.some(
				({ baselineWork, workBudget }) => baselineWork !== undefined && baselineWork > workBudget,
			),
		).toBe(true);
		for (const pass of passes ?? []) {
			expect(pass.baselineWork).toBeGreaterThan(0);
			expect(pass.work).toBeLessThanOrEqual(pass.workBudget);
		}
	});

	// Two groups interleave a binary tree: root nodes relate to both blocks across rows where
	// the blocks stand as walls. The documentary order itself must route around their frames.
	it.each([
		['subgroups', 24],
		['subgroups', 60],
		['shallow-groups', 24],
		['shallow-groups', 60],
	] as const)(
		'%s keeps a valid documentary layout around its group blocks at %i nodes',
		async (name, nodeCount) => {
			const scenario = LAYOUT_PERFORMANCE_SCENARIOS.find((candidate) => candidate.name === name);
			if (scenario === undefined) throw new Error(`Missing performance scenario ${name}`);
			const { graph, ranks, measurements } = prepareLayoutPerformanceScenario(scenario, nodeCount);
			const documentary = evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements);
			expect(
				validateDedicatedCandidate({ graph, ranks, measurements, layout: documentary }),
			).toMatchObject({ valid: true });
			const shipped = await layoutPreparedScenario(
				prepareLayoutPerformanceScenario(scenario, nodeCount),
			);
			expect(
				validateDedicatedCandidate({ graph, ranks, measurements, layout: shipped }),
			).toMatchObject({
				valid: true,
			});
		},
	);

	it.each(LAYOUT_PERFORMANCE_SCENARIOS)(
		'$name rejects invalid node counts',
		({ createBuilder }) => {
			for (const value of [0, -1, 1.5, Number.NaN]) {
				expect(() => createBuilder().buildSnapshot(value)).toThrow('positive integer');
			}
		},
	);

	for (const scenario of LAYOUT_PERFORMANCE_SCENARIOS) {
		describe(scenario.name, () => {
			it.each(nodeCounts)('builds a valid deterministic %i-node layout', async (nodeCount) => {
				const [first, second] = buildPreparedScenarioTwice(scenario, nodeCount);

				expect(second).toEqual(first);
				expect(scenarioDocumentIsValid(first)).toBe(true);
				expect(first.nodeCount).toBe(nodeCount);
				expect(first.document.nodes).toHaveLength(nodeCount);
				const endpointIds = new Set([
					...first.document.groups.map(({ id }) => id),
					...first.document.nodes.map(({ id }) => id),
					...first.document.junctions.map(({ id }) => id),
				]);
				expect(first.graph.rankableEndpointIds.every((id) => endpointIds.has(id))).toBe(true);
				const rankableIds = new Set(first.graph.rankableEndpointIds);
				expect(first.document.nodes.every(({ id }) => rankableIds.has(id))).toBe(true);
				expect(first.document.junctions.every(({ id }) => rankableIds.has(id))).toBe(true);

				const layout = await layoutPreparedScenario(first);
				expect(Number.isFinite(layout.width)).toBe(true);
				expect(Number.isFinite(layout.height)).toBe(true);
				expect(layout.elements.filter(({ kind }) => kind === EndpointKind.Node)).toHaveLength(
					nodeCount,
				);
			});

			it('keeps returned documents and ranks isolated across builder resets', () => {
				const builder = scenario.createBuilder();
				const initialDocument = builder.buildInitialDocument();
				const initialBefore = structuredClone(initialDocument);
				const snapshot = builder.buildSnapshot(50);
				const snapshotDocumentBefore = structuredClone(snapshot.document);
				const snapshotRanksBefore = snapshot.nodeRanks.map((rank) => [...rank]);

				builder.buildSnapshot(1);

				expect(initialDocument).toEqual(initialBefore);
				expect(snapshot.document).toEqual(snapshotDocumentBefore);
				expect(snapshot.nodeRanks).toEqual(snapshotRanksBefore);
			});

			it.each(nodeCounts)(
				'keeps snapshot and insertion prefixes identical at %i nodes',
				(nodeCount) => {
					const builder = scenario.createBuilder();
					const snapshot = builder.buildSnapshot(nodeCount);
					const insertions = builder.buildInsertions(nodeCount);
					let replayed: LogicDocument = {
						...snapshot.document,
						groups: [],
						nodes: [],
						junctions: [],
						relations: [],
					};
					for (const insertion of insertions) {
						replayed = applyLayoutPerformanceInsertion(replayed, insertion);
					}

					expect(insertions).toHaveLength(nodeCount);
					expect(new Set(insertions.map(({ node }) => node.id)).size).toBe(nodeCount);
					expect(replayed).toEqual(snapshot.document);
				},
			);
		});
	}
});
