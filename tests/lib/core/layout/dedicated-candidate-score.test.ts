import { describe, expect, it } from 'vitest';

import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { compareDedicatedRouteScores } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-score';
import { routeScore } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-score';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { evaluateDedicatedLayout } from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
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
	it('scores materialized crossings and validated bridges', () => {
		expect(routeScore(routeBridgeAnalysis(crossingLayout.relations))).toEqual({
			strictCrossings: 1,
			validatedBridges: 1,
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
				const layout = evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements);
				const validation = validateDedicatedCandidate({ graph, ranks, measurements, layout });
				if (!validation.valid)
					throw new Error(`Expected validated candidate, got ${validation.code}`);
				return validation.score;
			});
		expect(scores).toEqual([
			{ strictCrossings: 2, validatedBridges: 2 },
			{ strictCrossings: 1, validatedBridges: 1 },
		]);
		const first = scores[0];
		const second = scores[1];
		if (first === undefined || second === undefined) throw new Error('Expected two scores');
		expect(compareDedicatedRouteScores(first, second)).toBe(1);
	});
});
