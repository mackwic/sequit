import { describe, expect, it } from 'vitest';

import {
	compareRankOrderCorpus,
	rankOrderComparisonCorpus,
} from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { countRankOrderCrossings } from '../../../../src/lib/core/layout/rank-order';

describe('rank order comparison', () => {
	const comparison = compareRankOrderCorpus(rankOrderComparisonCorpus());

	it('validates both orders and never worsens crossings by enumerating', () => {
		expect(comparison.entries.map(({ id }) => id)).toEqual([
			'adjacent-3+1',
			'adjacent-2+2',
			'two-successors',
			'two-predecessors',
			'three-predecessors',
		]);
		for (const entry of comparison.entries) {
			expect(entry.documentaryValid).toBe(true);
			expect(entry.enumeratedValid).toBe(true);
			expect(entry.enumeratedCount).toBeGreaterThan(0);
			expect(entry.enumeratedCrossings).toBeLessThanOrEqual(entry.documentaryCrossings);
		}
	});

	it('reports the 3+1 documentary target order as a crossing divergence', () => {
		const entry = comparison.entries.find(({ id }) => id === 'adjacent-3+1');
		expect(entry).toBeDefined();
		if (entry === undefined) return;
		expect(entry.divergence).toBe(true);
		expect(entry.documentaryCrossings).toBe(2);
		expect(entry.enumeratedCrossings).toBe(0);
		expect(entry.documentary[0]).toEqual(['d', 'e']);
		expect(entry.documentary[1]).toEqual(['a', 'b', 'c']);
		expect(entry.enumerated).not.toEqual(entry.documentary);
		expect(entry.enumeratedCount).toBe(12);
		// The known witness: inverting the target band strictly lowers the crossing count.
		expect(
			countRankOrderCrossings(
				[
					['e', 'd'],
					['a', 'b', 'c'],
				],
				entry.relations,
			),
		).toBeLessThan(countRankOrderCrossings(entry.documentary, entry.relations));
	});

	it('keeps the dedicated engine result unchanged for every corpus entry', () => {
		for (const entry of comparison.entries) {
			const created = createGraph(entry.document);
			expect(created.ok).toBe(true);
			if (!created.ok) return;
			const ranks = topologicallyRank(created.value);
			expect(entry.layout).toEqual(
				layoutWithDedicatedEngine(created.value, ranks, entry.measurements),
			);
		}
	});
});
