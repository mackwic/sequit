import { afterAll, describe, expect, it } from 'vitest';

import { LAYOUT_PERFORMANCE_SCENARIOS } from '../scenarios/layout-performance/scenarios';
import { incrementalLayoutBudgetMs } from './incremental-layout-budgets';
import { INCREMENTAL_LAYOUT_RESPONSIVENESS_TARGETS_MS } from './layout-performance-policy';
import {
	INCREMENTAL_LAYOUT_TIMING_STAGES,
	prepareIncrementalLayoutReplay,
	replayIncrementalLayout,
	summarizeIncrementalLayoutReplays,
} from './replay-incremental-layout';

const inputs = LAYOUT_PERFORMANCE_SCENARIOS.map((scenario) =>
	prepareIncrementalLayoutReplay(scenario, 1000),
);
const calibrationRows: string[] = [];
const uxRows: string[] = [];

function uxStatus(observed: number, target: number): 'PASS' | 'GAP' {
	if (observed < target) return 'PASS';
	return 'GAP';
}

describe('incremental layout performance', { concurrent: false }, () => {
	for (const input of inputs) {
		it(
			input.scenario.name,
			async () => {
				await replayIncrementalLayout(input);
				const measuredReplays = [];
				for (let replayIndex = 0; replayIndex < 3; replayIndex += 1) {
					measuredReplays.push(await replayIncrementalLayout(input));
				}
				const summaries = summarizeIncrementalLayoutReplays(measuredReplays);

				for (const summary of summaries) {
					const totalP95 = summary.stages.totalMs.p95;
					const synchronousP95 = summary.stages.synchronousProjectionMs.p95;
					const budget = incrementalLayoutBudgetMs(input.scenario.name, summary.bucket);
					calibrationRows.push(
						`${input.scenario.name},${summary.bucket},${totalP95.toFixed(3)},${budget}`,
					);
					const slowestStages = INCREMENTAL_LAYOUT_TIMING_STAGES.map(
						(stage) => `${stage}=${summary.slowestInsertion.timing[stage].toFixed(3)}`,
					).join(' ');
					uxRows.push(
						`${input.scenario.name},${summary.bucket},sync=${synchronousP95.toFixed(3)}ms:${uxStatus(synchronousP95, INCREMENTAL_LAYOUT_RESPONSIVENESS_TARGETS_MS.synchronousProjection)},total=${totalP95.toFixed(3)}ms:${uxStatus(totalP95, INCREMENTAL_LAYOUT_RESPONSIVENESS_TARGETS_MS.total)},slowestNodeIndex=${summary.slowestInsertion.nodeIndex} ${slowestStages}`,
					);

					expect(
						totalP95,
						`${input.scenario.name}/${summary.bucket}: total p95 ${totalP95.toFixed(2)} ms, calibrated budget <${budget} ms; slowest insertion ${summary.slowestInsertion.nodeIndex}`,
					).toBeLessThan(budget);
				}
			},
			1_200_000,
		);
	}
});

afterAll(() => {
	process.stderr.write(
		`\nIncremental calibration results (scenario,bucket,totalP95Ms,budgetMs)\n${calibrationRows.join('\n')}\n\nFixed UX goals (PASS or GAP; goals do not alter calibrated gates)\n${uxRows.join('\n')}\n`,
	);
});
