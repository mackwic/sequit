import { describe, expect, it } from 'vitest';

import { applyLayoutPerformanceInsertion } from '../../../../src/app/workshop/fixtures/layout-performance/apply-layout-performance-insertion';
import { LayoutPerformanceScenarioBuilder } from '../../../../src/app/workshop/fixtures/layout-performance/layout-performance-scenario-builder';
import { LAYOUT_PERFORMANCE_SCENARIO_NAMES } from '../../../../src/app/workshop/fixtures/layout-performance/scenario-name';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../../src/app/workshop/fixtures/layout-performance/scenarios';
import { EndpointKind, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import {
	buildPreparedScenarioTwice,
	layoutPreparedScenario,
	scenarioDocumentIsValid,
} from '../../../support/harnesses/layout-performance-scenario';

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
