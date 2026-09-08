import { describe, expect, it } from 'vitest';

import { applyLayoutPerformanceInsertion } from '../../../../src/app/workshop/fixtures/layout-performance/apply-layout-performance-insertion';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../../src/app/workshop/fixtures/layout-performance/scenarios';

const equivalenceNodeCounts = [
	1, 2, 3, 9, 10, 11, 18, 19, 20, 49, 50, 51, 99, 100, 101, 999, 1000,
] as const;
const checkpointNodeCounts: ReadonlySet<number> = new Set(equivalenceNodeCounts);

describe.each(LAYOUT_PERFORMANCE_SCENARIOS)('$name incremental replay', (scenario) => {
	it('adds one auditable node per transaction and matches every snapshot prefix', () => {
		const builder = scenario.createBuilder();
		const insertions = builder.buildInsertions(1000);
		let document = builder.buildInitialDocument();

		expect(insertions).toHaveLength(1000);
		for (const [nodeIndex, insertion] of insertions.entries()) {
			const previousEndpointIds = new Set([
				...document.groups.map(({ id }) => id),
				...document.nodes.map(({ id }) => id),
				...document.junctions.map(({ id }) => id),
			]);
			const previousRelationIds = new Set(document.relations.map(({ id }) => id));

			expect(insertion.name).toBe(scenario.name);
			expect(insertion.nodeIndex).toBe(nodeIndex);
			expect(previousEndpointIds.has(insertion.node.id)).toBe(false);
			expect(new Set(insertion.removedRelationIds).size).toBe(insertion.removedRelationIds.length);
			for (const relationId of insertion.removedRelationIds) {
				expect(previousRelationIds.has(relationId)).toBe(true);
			}

			const previousNodes = document.nodes;
			document = applyLayoutPerformanceInsertion(document, insertion);
			expect(document.nodes).toHaveLength(nodeIndex + 1);
			expect(document.nodes.slice(0, -1)).toEqual(previousNodes);

			const nodeCount = nodeIndex + 1;
			if (checkpointNodeCounts.has(nodeCount)) {
				expect(document).toEqual(scenario.createBuilder().buildSnapshot(nodeCount).document);
			}
		}
	}, 30_000);
});
