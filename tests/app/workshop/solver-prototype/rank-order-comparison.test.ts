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
	it('reports the chosen geometric rank displacement, not the abstract enumerated proxy', () => {
		const geometric = comparison.entries.find(({ id }) => id === 'geometric-2+2');
		const neutral = comparison.entries.find(({ id }) => id === 'two-predecessors');
		expect(geometric?.selectedOrder).toEqual([
			['d', 'e'],
			['a', 'c', 'b'],
		]);
		expect(geometric?.selectedKendall).toBe(1);
		expect(geometric?.selectedRouteScore?.strictCrossings).toBe(0);
		expect(neutral?.selectedOrder).toEqual(neutral?.documentary);
		expect(neutral?.selectedKendall).toBe(0);
	});

	it('matches pinned dedicated-engine layout fingerprints for every corpus entry', () => {
		const expected: Record<string, string> = {
			'geometric-3+1': '3e38011f572fda44003de0ced6f62ae35ccefcb3b9bfec3818d2954099211fc8',
			'geometric-2+2': '49b25131fc1eed3895523a09cfa7946fc337751a2ccbe192eb0a025fe1a33c79',
			'adjacent-3+1': '245bfb9ce2a9e05f0ad28f28b08b589e5f351859c3190edf377525036531a4a6',
			'adjacent-2+2': '655c66415e986bf51753f003a98f783b90afee9d2b36e55a8a7f91c386a18fdd',
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

	it('exposes three distinct real archetypes, local edits, documentary crossings and independent controls', () => {
		for (const id of ['evaporating-cloud', 'goal-implementation', 'decision-tree']) {
			const mutation = rankOrderMutationCorpus().find((entry) => entry.id === id);
			const measured = comparisons.find((entry) => entry.id === id);
			expect(mutation?.before.document.relations).toContainEqual({
				id: 'control-input--control-output',
				from: 'control-input',
				to: 'control-output',
			});
			expect(mutation?.after.document.relations.length).toBe(
				(mutation?.before.document.relations.length ?? 0) + 1,
			);
			expect(measured?.beforeCrossings).toBeLessThanOrEqual(
				measured?.beforeDocumentaryCrossings ?? -1,
			);
			expect(measured?.afterCrossings).toBeLessThanOrEqual(
				measured?.afterDocumentaryCrossings ?? -1,
			);
			expect(measured?.components).toHaveLength(2);
			expect(measured?.components.filter(({ touched }) => touched)).toHaveLength(1);
			expect(measured?.components.filter(({ touched }) => !touched)).toHaveLength(1);
			expect(measured?.components.find(({ touched }) => !touched)?.selected.invertedRankPairs).toBe(
				0,
			);
		}
		const goal = comparisons.find(({ id }) => id === 'goal-implementation');
		expect(goal).toMatchObject({
			beforeCrossings: 0,
			beforeDocumentaryCrossings: 3,
			afterCrossings: 7,
			afterDocumentaryCrossings: 8,
		});
		const decision = comparisons.find(({ id }) => id === 'decision-tree');
		expect(decision?.beforeCrossings).toBeLessThan(decision?.beforeDocumentaryCrossings ?? 0);
	});

	it('measures boxes, route endpoints, full paths and changed ranks after add/remove edits', () => {
		expect(comparisons.map(({ id }) => id)).toEqual([
			'evaporating-cloud',
			'goal-implementation',
			'decision-tree',
			'add-relation',
			'remove-relation',
			'measurement-change',
			'rename-endpoint',
			'add-node',
			'add-isolated-node',
			'remove-node',
			'budget-frontier',
			'unrelated-shortcut',
		]);
		const addition = comparisons.find(({ id }) => id === 'add-node');
		const removal = comparisons.find(({ id }) => id === 'remove-relation');
		const removedNode = comparisons.find(({ id }) => id === 'remove-node');
		expect(addition).toMatchObject({
			addedElements: 1,
			addedRelations: 1,
			commonElements: 5,
			movedElements: 5,
			rankChanges: 0,
			commonRelations: 4,
			portChanges: 4,
			pathChanges: 4,
			commonRouteLengthBefore: 828,
			commonRouteLengthAfter: 520,
			commonBendsBefore: 8,
			commonBendsAfter: 4,
			beforeCrossings: 0,
			afterCrossings: 0,
		});
		expect(addition?.meanNormalizedMovement).toBeCloseTo(0.52);
		expect(removal).toMatchObject({
			removedRelations: 1,
			commonElements: 5,
			rankChanges: 1,
			commonRelations: 3,
			portChanges: 3,
			pathChanges: 3,
			commonRouteLengthBefore: 650,
			commonRouteLengthAfter: 332,
			commonBendsBefore: 6,
			commonBendsAfter: 2,
		});
		expect(removedNode).toMatchObject({
			removedElements: 1,
			removedRelations: 1,
			commonElements: 4,
			movedElements: 4,
			commonRelations: 3,
		});
	});

	it('does not invert selected or documentary bands when an endpoint identifier is renamed', () => {
		const renamed = comparisons.find(({ id }) => id === 'rename-endpoint');
		const restoreId = (bands: readonly (readonly string[])[]) =>
			bands.map((band) =>
				band.map((id) => {
					if (id === 'renamed-b') return 'b';
					return id;
				}),
			);
		expect(restoreId(renamed?.afterWitness.selectedOrder ?? [])).toEqual(
			renamed?.beforeWitness.selectedOrder,
		);
		expect(renamed).toMatchObject({
			invertedRankPairs: 0,
			documentary: { invertedRankPairs: 0 },
			beforeCrossings: 0,
			afterCrossings: 0,
		});
	});

	it('attributes a width-only measurement edit and distinguishes relative motion from shared translation', () => {
		const resized = comparisons.find(({ id }) => id === 'measurement-change');
		expect(resized).toMatchObject({
			addedElements: 0,
			removedElements: 0,
			addedRelations: 0,
			removedRelations: 0,
			commonElements: 5,
			rankChanges: 0,
			commonRelations: 4,
			portChanges: 4,
			pathChanges: 4,
			beforeCrossings: 0,
			afterCrossings: 0,
			medianTranslation: { x: 58, y: -24 },
			relativeMovedElements: 4,
			documentary: {
				commonElements: 5,
				rankChanges: 0,
				medianTranslation: { x: 24, y: 0 },
				relativeMovedElements: 2,
			},
		});
		expect(resized?.meanRelativeNormalizedMovement).toBeCloseTo(0.328);
		expect(resized?.documentary.meanRelativeNormalizedMovement).toBeCloseTo(0.096);
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
			relativeMovedElements: 0,
			medianTranslation: { x: 0, y: 0 },
			documentary: { movedElements: 0, relativeMovedElements: 0 },
			pathChanges: 0,
			commonRouteLengthBefore: 828,
			commonRouteLengthAfter: 828,
			commonBendsBefore: 8,
			commonBendsAfter: 8,
			beforeCrossings: 0,
			afterCrossings: 0,
		});
		expect(isolated?.meanNormalizedMovement).toBe(0);
	});

	it('compares a complete document replacement without dividing by zero or matching stale ids', () => {
		const before = rankOrderMutationCorpus().find(({ id }) => id === 'add-relation')?.before;
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
		const before = rankOrderMutationCorpus().find(({ id }) => id === 'add-relation')?.before;
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

	it('crosses the local 17-to-18 relation frontier without resetting a valid optimum', () => {
		const frontier = comparisons.find(({ id }) => id === 'budget-frontier');
		expect(frontier).toMatchObject({
			addedRelations: 1,
			commonElements: 18,
			rankChanges: 0,
			commonRelations: 17,
			movedElements: 13,
			relativeMovedElements: 5,
			medianTranslation: { x: 116, y: 0 },
			portChanges: 13,
			pathChanges: 13,
			commonRouteLengthBefore: 1764,
			commonRouteLengthAfter: 1880,
			commonBendsBefore: 8,
			commonBendsAfter: 10,
			beforeCrossings: 0,
			afterCrossings: 0,
			beforeWitness: {
				components: [
					{
						pipelineLimit: 12,
						selected: [
							['d', 'e'],
							['a', 'c', 'b'],
						],
					},
				],
			},
			afterWitness: {
				components: [
					{
						pipelineLimit: 11,
						selected: [
							['d', 'e'],
							['a', 'c', 'b'],
						],
					},
				],
			},
			documentary: { movedElements: 13, relativeMovedElements: 5 },
		});
		expect(frontier?.meanNormalizedMovement).toBeCloseTo(0.937);
		expect(frontier?.meanRelativeNormalizedMovement).toBeCloseTo(0.322);
		expect(frontier?.documentary.meanNormalizedMovement).toBeCloseTo(0.533);
		expect(frontier?.documentary.meanRelativeNormalizedMovement).toBeCloseTo(0.166);
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
			commonRouteLengthBefore: 5464,
			commonRouteLengthAfter: 5134,
			commonBendsBefore: 8,
			commonBendsAfter: 12,
			beforeCrossings: 0,
			afterCrossings: 0,
			afterWitness: { stop: 'complete' },
			relativeMovedElements: 6,
			medianTranslation: { x: 44, y: -48 },
			documentary: {
				movedElements: 65,
				relativeMovedElements: 5,
				medianTranslation: { x: 8, y: 0 },
			},
		});
		expect(unrelated?.meanNormalizedMovement).toBeGreaterThan(0.7);
		expect(unrelated?.meanNormalizedMovement).toBeLessThan(0.8);
		expect(unrelated?.meanRelativeNormalizedMovement).toBeCloseTo(0.04457);
		expect(unrelated?.documentary.meanRelativeNormalizedMovement).toBeCloseTo(0.00578);
	});
});
