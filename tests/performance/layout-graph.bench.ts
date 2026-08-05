import { bench, describe } from 'vitest';

import { layoutGraph } from '../../src/lib/layout/layout-graph';
import { layoutPerformanceCases } from './layout-performance-cases';
import { LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS } from './layout-performance-policy';

const cases = layoutPerformanceCases();

describe('layoutGraph', () => {
	for (const { caseName, prepared } of cases) {
		bench(
			caseName,
			async () => {
				await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
			},
			LAYOUT_PERFORMANCE_BENCHMARK_OPTIONS,
		);
	}
});
