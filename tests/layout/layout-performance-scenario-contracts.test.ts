import { describe, expect, it } from 'vitest';

import type { LogicDocument } from '../../src/lib/document/logic-document';
import {
	buildPreparedScenarioTwice,
	layoutPreparedScenario,
	scenarioDocumentIsValid,
} from '../harnesses/layout-performance-scenario';
import { applyLayoutPerformanceInsertion } from '../scenarios/layout-performance/apply-layout-performance-insertion';
import { LAYOUT_PERFORMANCE_SCENARIO_NAMES } from '../scenarios/layout-performance/scenario-name';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../scenarios/layout-performance/scenarios';

const nodeCounts = [1, 10, 19, 50] as const;

describe('layout performance scenario contracts', () => {
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
				const expectedRankableIds = new Set([
					...first.document.nodes.map(({ id }) => id),
					...first.document.junctions.map(({ id }) => id),
					...first.document.relations.flatMap(({ from, to }) => [from, to]),
				]);
				expect(first.graph.rankableEndpointIds).toHaveLength(expectedRankableIds.size);

				const layout = await layoutPreparedScenario(first);
				expect(Number.isFinite(layout.width)).toBe(true);
				expect(Number.isFinite(layout.height)).toBe(true);
				expect(layout.elements.filter(({ kind }) => kind === 'node')).toHaveLength(nodeCount);
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
