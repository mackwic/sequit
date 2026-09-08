import { bench, describe } from 'vitest';

import { createGraph } from '../../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../../src/lib/core/graph/topological-ranks';
import { layoutPerformanceCases } from '../../../../support/performance/layout-performance-cases';
import { LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS } from '../../../../support/performance/layout-performance-policy';

const cases = layoutPerformanceCases();

describe('createGraph', () => {
	for (const { caseName, prepared } of cases) {
		bench(
			caseName,
			() => {
				createGraph(prepared.document);
			},
			LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS,
		);
	}
});

describe('topologicallyRank', () => {
	for (const { caseName, prepared } of cases) {
		bench(
			caseName,
			() => {
				topologicallyRank(prepared.graph);
			},
			LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS,
		);
	}
});
