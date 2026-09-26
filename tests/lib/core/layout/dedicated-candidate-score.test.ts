import { describe, expect, it } from 'vitest';

import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import {
	compareDedicatedRouteScores,
	scoreDedicatedCandidateRoutes,
	validateDedicatedCandidate,
} from '../../../../src/lib/core/layout/dedicated-candidate-validation';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';

const crossingLayout: LayoutResult = {
	width: 100,
	height: 100,
	elements: [],
	relations: [
		{
			id: 'horizontal',
			from: 'west',
			to: 'east',
			points: [
				{ x: 10, y: 50 },
				{ x: 90, y: 50 },
			],
		},
		{
			id: 'vertical',
			from: 'north',
			to: 'south',
			points: [
				{ x: 50, y: 10 },
				{ x: 50, y: 90 },
			],
		},
	],
};

describe('dedicated candidate route scoring', () => {
	it('scores materialized crossings, validated bridges, Manhattan length, and bends', () => {
		expect(scoreDedicatedCandidateRoutes(crossingLayout)).toEqual({
			strictCrossings: 1,
			validatedBridges: 1,
			length: 160,
			bends: 0,
		});
	});

	it('scores two fully validated dedicated layouts by their materialized crossings', () => {
		const scores = rankOrderComparisonCorpus()
			.slice(0, 2)
			.map(({ document }) => {
				const created = createGraph(document);
				if (!created.ok) throw new Error('Expected a valid rank-order case');
				const graph = created.value;
				const ranks = topologicallyRank(graph);
				const measurements = layoutMeasurementsFor(document);
				const layout = layoutWithDedicatedEngine(graph, ranks, measurements);
				const validation = validateDedicatedCandidate({ graph, ranks, measurements, layout });
				if (!validation.valid)
					throw new Error(`Expected validated candidate, got ${validation.code}`);
				expect(scoreDedicatedCandidateRoutes(layout)).toEqual(validation.score);
				return validation.score;
			});
		expect(scores).toEqual([
			{ strictCrossings: 4, validatedBridges: 4, length: 1408, bends: 8 },
			{ strictCrossings: 3, validatedBridges: 3, length: 1056, bends: 8 },
		]);
		const first = scores[0];
		const second = scores[1];
		if (first === undefined || second === undefined) throw new Error('Expected two scores');
		expect(compareDedicatedRouteScores(first, second)).toBe(1);
	});

	it('compares crossings and bridges lexicographically, not observed length or bends', () => {
		expect(
			compareDedicatedRouteScores(
				{ strictCrossings: 2, validatedBridges: 1, length: 1, bends: 1 },
				{ strictCrossings: 2, validatedBridges: 1, length: 100, bends: 100 },
			),
		).toBe(0);
		expect(
			compareDedicatedRouteScores(
				{ strictCrossings: 2, validatedBridges: 2, length: 1, bends: 1 },
				{ strictCrossings: 2, validatedBridges: 1, length: 100, bends: 100 },
			),
		).toBe(1);
		expect(
			compareDedicatedRouteScores(
				{ strictCrossings: 1, validatedBridges: 9, length: 1, bends: 1 },
				{ strictCrossings: 2, validatedBridges: 0, length: 100, bends: 100 },
			),
		).toBe(-1);
	});
});
