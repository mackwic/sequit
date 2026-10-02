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
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import { countRankOrderCrossings } from '../../../../src/lib/core/layout/rank/rank-order';
import { AssertRoutes } from '../../../support/assertions/assert-routes';

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
		// Centering A on both targets pushes B and C beside D: the documentary geometry keeps the
		// two crossings of A → E with the arrivals of B and C on D. Those arrivals share D and are
		// stacked on distinct rails without crossing each other; the selected order crosses nothing.
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
			strictCrossings: 1,
			validatedBridges: 1,
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
			'geometric-3+1': '3b2354e63b154eb6b5d96f42e5f44adeb10657a40e4e987aac08b8d05f444db7',
			'geometric-2+2': '31d6aa7a5ef8b8444a7bd888efe1b225dcb2b10d9bac2e634e29976c4999263e',
			'adjacent-3+1': '0fbc1b295e8638bfc03d1d6c929be423c0d03f5a408b56eb5308f0b76c14b71e',
			'adjacent-2+2': '8d01a1f76e5e210e62fa16d9e9cce75ef7771c0d37b02042845d6ee4d54e04d0',
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
		const decision = comparisons.find(({ id }) => id === 'decision-tree');
		expect(decision?.beforeCrossings).toBeLessThan(decision?.beforeDocumentaryCrossings ?? 0);
	});

	it('keeps the edited goal implementation free of selected route crossings', () => {
		const goal = comparisons.find(({ id }) => id === 'goal-implementation');
		if (goal === undefined) throw new Error('Missing goal implementation witness');
		expect(goal.afterCrossings).toBe(0);
		expect(goal.afterDocumentaryCrossings).toBeGreaterThan(0);
		const mutation = rankOrderMutationCorpus().find(({ id }) => id === 'goal-implementation');
		if (mutation === undefined) throw new Error('Missing edited goal document');
		const graphResult = createGraph(mutation.after.document);
		if (!graphResult.ok) throw new Error('Invalid edited goal document');
		const graph = graphResult.value;
		const layout = layoutWithDedicatedEngineAndRankOrderWitness(
			graph,
			topologicallyRank(graph),
			mutation.after.measurements,
		).layout;
		AssertRoutes(layout.relations).haveNoForbiddenContacts();
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
			commonRouteLengthBefore: 578,
			commonRouteLengthAfter: 456,
			commonBendsBefore: 6,
			commonBendsAfter: 6,
			beforeCrossings: 0,
			afterCrossings: 0,
		});
		expect(addition?.components).toHaveLength(1);
		expect(addition?.components[0]?.touched).toBe(true);
		expect(removal).toMatchObject({
			removedRelations: 1,
			commonElements: 5,
			rankChanges: 1,
			commonRelations: 3,
			portChanges: 3,
			pathChanges: 3,
			commonRouteLengthBefore: 424,
		});
		expect(removal?.commonRouteLengthAfter).toBeLessThan(removal?.commonRouteLengthBefore ?? 0);
		expect(removal?.commonBendsAfter).toBeLessThanOrEqual(removal?.commonBendsBefore ?? 0);
		expect(removal?.commonRouteLengthAfter).toBeLessThanOrEqual(388);
		expect(removal?.commonBendsAfter).toBeLessThanOrEqual(4);
		const mutation = rankOrderMutationCorpus().find(({ id }) => id === 'remove-relation');
		if (mutation === undefined) throw new Error('Missing removal witness');
		const graphResult = createGraph(mutation.after.document);
		if (!graphResult.ok) throw new Error('Invalid removal witness');
		const graph = graphResult.value;
		const after = layoutWithDedicatedEngineAndRankOrderWitness(
			graph,
			topologicallyRank(graph),
			mutation.after.measurements,
		).layout;
		const route = (id: string) => {
			const found = after.relations.find((candidate) => candidate.id === id);
			if (found === undefined) throw new Error(`Missing removal route ${id}`);
			return found;
		};
		const fromA = route('a-d');
		const fromB = route('b-d');
		const branch = route('b-e');
		expect(fromB.points[0]).toEqual(branch.points[0]);
		expect(fromA.points.at(-1)).not.toEqual(fromB.points.at(-1));
		AssertRoutes(after.relations).haveOnlyAllowedSharedTrunks();
		expect(removedNode).toMatchObject({
			removedElements: 1,
			removedRelations: 1,
			commonElements: 4,
			movedElements: 4,
			commonRelations: 3,
		});
	});

	it('counts only surviving same-rank pairs when a local edit splits a four-root goal band', () => {
		const base = rankOrderComparisonCorpus().find(({ id }) => id === 'three-predecessors');
		if (base === undefined) throw new Error('Missing three-root rank witness');
		const last = base.document.nodes.find(({ id }) => id === 'c');
		if (last === undefined) throw new Error('Missing third root');
		const fourth = { ...last, id: 'e', markdown: 'E' };
		const before = {
			...base,
			document: {
				...base.document,
				nodes: [...base.document.nodes, fourth],
				relations: [...base.document.relations, { id: 'e-d', from: 'e', to: 'd' }],
			},
			measurements: {
				...base.measurements,
				nodes: new Map([...base.measurements.nodes, ['e', { width: 80, height: 60 }] as const]),
			},
		};
		const after = {
			...before,
			document: {
				...before.document,
				relations: [
					...before.document.relations,
					{ id: 'a-b', from: 'a', to: 'b' },
					{ id: 'e-b', from: 'e', to: 'b' },
				],
			},
		};
		const [comparison] = compareRankOrderMutations([
			{
				id: 'split-goal-roots',
				label: 'Split root rank by adding two causal links',
				before,
				after,
			},
		]);
		expect(comparison).toMatchObject({
			addedRelations: 2,
			rankChanges: 2,
			commonRankPairs: 1,
			invertedRankPairs: 0,
			documentary: { commonRankPairs: 1, invertedRankPairs: 0 },
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
			portChanges: 2,
			pathChanges: 2,
			beforeCrossings: 0,
			afterCrossings: 0,
			medianTranslation: { x: 0, y: 0 },
			relativeMovedElements: 2,
			documentary: {
				commonElements: 5,
				rankChanges: 0,
				medianTranslation: { x: 24, y: 0 },
				relativeMovedElements: 2,
			},
		});
		expect(resized?.meanRelativeNormalizedMovement).toBeCloseTo(0.128);
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
			commonRouteLengthBefore: 578,
			commonRouteLengthAfter: 578,
			commonBendsBefore: 6,
			commonBendsAfter: 6,
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
			movedElements: 14,
			relativeMovedElements: 4,
			medianTranslation: { x: 116, y: 0 },
			portChanges: 14,
			pathChanges: 14,
			commonRouteLengthBefore: 1514,
			commonRouteLengthAfter: 1746,
			commonBendsBefore: 6,
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
		expect(frontier?.meanNormalizedMovement).toBeCloseTo(1.001);
		expect(frontier?.meanRelativeNormalizedMovement).toBeCloseTo(0.235);
		expect(frontier?.documentary.meanNormalizedMovement).toBeCloseTo(0.533);
		expect(frontier?.documentary.meanRelativeNormalizedMovement).toBeCloseTo(0.166);
	});

	it('preserves the rank order, box sizes and relative ports of untouched components', () => {
		for (const mutation of rankOrderMutationCorpus()) {
			const comparison = comparisons.find(({ id }) => id === mutation.id);
			if (comparison === undefined) throw new Error(`Missing stability comparison: ${mutation.id}`);
			const layout = (side: typeof mutation.before) => {
				const created = createGraph(side.document);
				if (!created.ok) throw new Error(`Invalid stability corpus graph: ${mutation.id}`);
				const graph = created.value;
				return layoutWithDedicatedEngineAndRankOrderWitness(
					graph,
					topologicallyRank(graph),
					side.measurements,
				).layout;
			};
			const before = layout(mutation.before);
			const after = layout(mutation.after);
			const oldBoxes = new Map(before.elements.map(({ id, bounds }) => [id, bounds]));
			const newBoxes = new Map(after.elements.map(({ id, bounds }) => [id, bounds]));
			const newRoutes = new Map(after.relations.map((route) => [route.id, route]));
			for (const component of comparison.components) {
				if (component.touched) continue;
				expect(component.selected.invertedRankPairs).toBe(0);
				expect(component.selected.rankChanges).toBe(0);
				const ids = new Set(component.ids);
				for (const id of ids) {
					const old = oldBoxes.get(id);
					const current = newBoxes.get(id);
					expect(old).toBeDefined();
					expect(current).toBeDefined();
					if (old === undefined || current === undefined) continue;
					expect({ width: current.width, height: current.height }).toEqual({
						width: old.width,
						height: old.height,
					});
				}
				for (const route of before.relations) {
					if (!ids.has(route.from) || !ids.has(route.to)) continue;
					const current = newRoutes.get(route.id);
					expect(current).toBeDefined();
					if (current === undefined) continue;
					for (const [id, oldPort, newPort] of [
						[route.from, route.points[0], current.points[0]],
						[route.to, route.points.at(-1), current.points.at(-1)],
					] as const) {
						const oldBox = oldBoxes.get(id);
						const newBox = newBoxes.get(id);
						if (
							oldPort === undefined ||
							newPort === undefined ||
							oldBox === undefined ||
							newBox === undefined
						)
							throw new Error(`Missing stable port: ${route.id}`);
						expect({ x: newPort.x - newBox.x, y: newPort.y - newBox.y }).toEqual({
							x: oldPort.x - oldBox.x,
							y: oldPort.y - oldBox.y,
						});
					}
				}
			}
		}
	});

	it('keeps the independent crossing optimum under a shortcut in another component', () => {
		const unrelated = comparisons.find(({ id }) => id === 'unrelated-shortcut');
		expect(unrelated).toMatchObject({
			addedRelations: 1,
			rankChanges: 0,
			beforeCrossings: 0,
			afterCrossings: 0,
			afterWitness: { stop: 'crossing-free' },
		});
		const independent = unrelated?.components.find(({ ids }) => ids.includes('a'));
		expect(independent).toMatchObject({ touched: false, selected: { invertedRankPairs: 0 } });
		const optimizedBand = (bands: readonly (readonly string[])[] | undefined) =>
			bands?.find((band) => band.includes('a'))?.filter((id) => ['a', 'b', 'c'].includes(id));
		expect(optimizedBand(unrelated?.beforeWitness.selectedOrder)).toEqual(
			optimizedBand(unrelated?.afterWitness.selectedOrder),
		);
		expect(independent?.selected.meanRelativeNormalizedMovement).toBe(0);
		expect(independent?.documentary.meanRelativeNormalizedMovement).toBe(0);
	});
});
