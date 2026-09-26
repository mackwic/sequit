import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
	compareRankOrderCorpus,
	rankOrderComparisonCorpus,
} from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import {
	compareRankOrderMutations,
	rankOrderMutationCorpus,
} from '../../../../src/app/workshop/solver-prototype/rank-order-stability';
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
			'geometric-3+1',
			'geometric-2+2',
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

	it('separates abstract crossing proxy from validated geometric routes', () => {
		const [threeOne, twoTwo, , , , geometricThreeOne, geometricTwoTwo] = comparison.entries;
		expect(threeOne?.documentaryCrossings).toBe(2);
		expect(twoTwo?.documentaryCrossings).toBe(1);
		expect(threeOne?.documentaryRouteScore).toMatchObject({
			strictCrossings: 2,
			validatedBridges: 2,
		});
		expect(geometricThreeOne?.documentaryRouteScore).toMatchObject({
			strictCrossings: 2,
			validatedBridges: 2,
		});
		expect(geometricTwoTwo?.documentaryRouteScore).toMatchObject({
			strictCrossings: 1,
			validatedBridges: 1,
		});
		expect(geometricThreeOne?.selectedRouteScore).toMatchObject({
			strictCrossings: 0,
			validatedBridges: 0,
		});
		expect(geometricTwoTwo?.selectedRouteScore).toMatchObject({
			strictCrossings: 0,
			validatedBridges: 0,
		});
		expect(twoTwo?.documentaryRouteScore).toMatchObject({
			strictCrossings: 3,
			validatedBridges: 3,
		});
		for (const entry of comparison.entries) {
			if (entry.documentaryRouteScore === undefined || entry.selectedRouteScore === undefined)
				continue;
			expect(entry.selectedRouteScore.strictCrossings).toBeLessThanOrEqual(
				entry.documentaryRouteScore.strictCrossings,
			);
			expect(entry.exhaustiveRouteScore?.strictCrossings).toBeLessThanOrEqual(
				entry.selectedRouteScore.strictCrossings,
			);
		}
	});

	it('matches pinned dedicated-engine layout fingerprints for every corpus entry', () => {
		const expected: Record<string, string> = {
			'geometric-3+1': '9e515a10436e726feaa7fef1799713c477a4b19dc8784a71ccba034a8c11ffb1',
			'geometric-2+2': '55d6a8f884cc8f0515c883533b58989deeb507c57ac922be7dd6c75faa6bd160',
			'adjacent-3+1': '68c2bfc4372097993c4bc012a3c1801522cce67b1cd85954d3834c3f0fef4650',
			'adjacent-2+2': 'ab97fab54a82c5173ef33d604c1e156201bf8d722b0e1e09b210afa9f78a32cf',
			'two-successors': 'cbef67223f47ce6a3ae02f7b451be2d111218576501be214a3cba1a06160a157',
			'two-predecessors': '72956e705ceb18d863ee61533d5c77604512850401a8fe71614ddf6922dacb01',
			'three-predecessors': 'b317d5a37873c18ff1bdfc1feb79efbfbc886a53e8b520ae2a1b7b4a8307a864',
		};
		for (const entry of comparison.entries) {
			expect(createHash('sha256').update(JSON.stringify(entry.layout)).digest('hex')).toBe(
				expected[entry.id],
			);
		}
	});
});

describe('rank order stability under document edits', () => {
	const comparisons = compareRankOrderMutations(rankOrderMutationCorpus());

	it('measures boxes, route endpoints, full paths and changed ranks after add/remove edits', () => {
		expect(comparisons.map(({ id }) => id)).toEqual([
			'add-relation',
			'remove-relation',
			'add-node',
			'add-isolated-node',
			'remove-node',
			'unrelated-shortcut',
		]);
		const addition = comparisons.find(({ id }) => id === 'add-node');
		const removal = comparisons.find(({ id }) => id === 'remove-relation');
		const removedNode = comparisons.find(({ id }) => id === 'remove-node');
		expect(addition).toMatchObject({
			addedElements: 1,
			addedRelations: 1,
			commonElements: 5,
			movedElements: 2,
			rankChanges: 0,
			commonRelations: 4,
			portChanges: 4,
			pathChanges: 4,
			commonRouteLengthBefore: 636,
			commonRouteLengthAfter: 520,
			commonBendsBefore: 8,
			commonBendsAfter: 4,
			beforeCrossings: 0,
			afterCrossings: 0,
		});
		expect(addition?.meanNormalizedMovement).toBeCloseTo(0.232);
		expect(removal).toMatchObject({
			removedRelations: 1,
			commonElements: 5,
			rankChanges: 1,
			commonRelations: 3,
			portChanges: 3,
			pathChanges: 3,
			commonRouteLengthBefore: 506,
			commonRouteLengthAfter: 332,
			commonBendsBefore: 6,
			commonBendsAfter: 2,
		});
		expect(removedNode).toMatchObject({
			removedElements: 1,
			removedRelations: 1,
			commonElements: 4,
			movedElements: 3,
			commonRelations: 3,
		});
	});

	it('preserves the geometry and ports of an independent component under a node-only append', () => {
		const isolated = comparisons.find(({ id }) => id === 'add-isolated-node');
		expect(isolated).toMatchObject({
			addedElements: 1,
			commonElements: 5,
			movedElements: 0,
			rankChanges: 0,
			commonRelations: 4,
			portChanges: 0,
			pathChanges: 0,
			commonRouteLengthBefore: 636,
			commonRouteLengthAfter: 636,
			commonBendsBefore: 8,
			commonBendsAfter: 8,
			beforeCrossings: 0,
			afterCrossings: 0,
		});
		expect(isolated?.meanNormalizedMovement).toBe(0);
	});

	it('compares a complete document replacement without dividing by zero or matching stale ids', () => {
		const before = rankOrderMutationCorpus()[0]?.before;
		if (before === undefined) throw new Error('Missing original mutation document');
		const original = before.document.nodes[0];
		if (original === undefined) throw new Error('Missing original node');
		const after = {
			...before,
			document: {
				...before.document,
				nodes: [{ ...original, id: 'replacement' }],
				relations: [],
			},
			measurements: {
				...before.measurements,
				nodes: new Map([['replacement', { width: 80, height: 60 }]]),
			},
		};
		const replacement = compareRankOrderMutations([
			{ id: 'replace-all', label: 'Replace all endpoints', before, after },
		])[0];
		expect(replacement).toMatchObject({
			addedElements: 1,
			removedElements: 5,
			removedRelations: 4,
			commonElements: 0,
			movedElements: 0,
			meanNormalizedMovement: 0,
			maxNormalizedMovement: 0,
			commonRelations: 0,
			portChanges: 0,
			pathChanges: 0,
			commonRouteLengthBefore: 0,
			commonRouteLengthAfter: 0,
			commonBendsBefore: 0,
			commonBendsAfter: 0,
		});
	});

	it('reports an invalid edited graph instead of comparing invalid layouts', () => {
		const before = rankOrderMutationCorpus()[0]?.before;
		if (before === undefined) throw new Error('Missing original mutation document');
		const duplicate = before.document.relations[0];
		if (duplicate === undefined) throw new Error('Missing original relation');
		const invalid = {
			...before,
			document: {
				...before.document,
				relations: [...before.document.relations, duplicate],
			},
		};
		expect(() =>
			compareRankOrderMutations([
				{ id: 'invalid-edit', label: 'Duplicate relation', before, after: invalid },
			]),
		).toThrow(/duplicate-relation-id/);
	});

	it('exposes a large physical packing shift without resetting the independent crossing optimum', () => {
		const unrelated = comparisons.find(({ id }) => id === 'unrelated-shortcut');
		expect(unrelated).toMatchObject({
			addedRelations: 1,
			commonElements: 70,
			movedElements: 70,
			rankChanges: 0,
			commonRelations: 68,
			portChanges: 68,
			pathChanges: 68,
			commonRouteLengthBefore: 5284,
			commonRouteLengthAfter: 5452,
			commonBendsBefore: 8,
			commonBendsAfter: 10,
			beforeCrossings: 0,
			afterCrossings: 0,
			afterWitness: { stop: 'complete', valid: 4 },
		});
		expect(unrelated?.meanNormalizedMovement).toBeGreaterThan(0.8);
		expect(unrelated?.meanNormalizedMovement).toBeLessThan(0.9);
	});
});
