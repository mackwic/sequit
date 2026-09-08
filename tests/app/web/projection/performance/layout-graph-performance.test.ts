import { performance } from 'node:perf_hooks';

import { afterAll, describe, expect, it } from 'vitest';

import { layoutGraph } from '../../../../../src/app/web/projection/layout-graph';
import { layoutPerformanceCases } from '../../../../support/performance/layout-performance-cases';
import {
	LAYOUT_PERFORMANCE_GATE_SAMPLE_RUNS,
	LAYOUT_PERFORMANCE_GATE_WARMUP_RUNS,
} from '../../../../support/performance/layout-performance-policy';
import { median } from '../../../../support/performance/performance-statistics';
import { layoutPerformanceBudgetMs } from '../../../../support/performance/snapshot-layout-budgets';

const cases = layoutPerformanceCases();
const observations: string[] = [];

describe('layoutGraph snapshot performance', { concurrent: false }, () => {
	for (const { scenario, nodeCount, prepared } of cases) {
		it(`${scenario.name}/nodes=${nodeCount}`, async () => {
			for (let index = 0; index < LAYOUT_PERFORMANCE_GATE_WARMUP_RUNS; index += 1) {
				await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
			}

			const durations: number[] = [];
			for (let index = 0; index < LAYOUT_PERFORMANCE_GATE_SAMPLE_RUNS; index += 1) {
				const start = performance.now();
				await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements);
				durations.push(performance.now() - start);
			}

			const observed = median(durations);
			const budget = layoutPerformanceBudgetMs(scenario.name, nodeCount);
			observations.push(`${scenario.name},${nodeCount},${observed.toFixed(3)},${budget}`);

			expect(
				observed,
				`${scenario.name}/nodes=${nodeCount}: median ${observed.toFixed(2)} ms, budget <${budget} ms`,
			).toBeLessThan(budget);
		}, 120_000);
	}
});

afterAll(() => {
	process.stdout.write(
		`\nSnapshot calibration results (scenario,nodeCount,medianMs,budgetMs)\n${observations.join('\n')}\n`,
	);
});
