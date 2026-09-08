import { bench, describe } from 'vitest';

import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../src/lib/fixtures/layout-performance/scenarios';
import {
	formatIncrementalLayoutCheckpointSummaries,
	formatIncrementalLayoutSummaries,
	type IncrementalLayoutReplayResult,
	prepareIncrementalLayoutReplay,
	replayIncrementalLayout,
	summarizeIncrementalLayoutCheckpoints,
	summarizeIncrementalLayoutReplays,
} from './replay-incremental-layout';

const inputs = LAYOUT_PERFORMANCE_SCENARIOS.map((scenario) =>
	prepareIncrementalLayoutReplay(scenario, 1000),
);
const replaysByScenario = new Map<string, IncrementalLayoutReplayResult[]>();
let reportGenerated = false;

async function generateIncrementalLayoutReport(): Promise<void> {
	if (reportGenerated) return;
	reportGenerated = true;
	for (const input of inputs) {
		await replayIncrementalLayout(input);
		const measuredReplays: IncrementalLayoutReplayResult[] = [];
		for (let replayIndex = 0; replayIndex < 3; replayIndex += 1) {
			measuredReplays.push(await replayIncrementalLayout(input));
		}
		replaysByScenario.set(input.scenario.name, measuredReplays);
	}

	const reports = inputs.flatMap((input) => {
		const measuredReplays = replaysByScenario.get(input.scenario.name) ?? [];
		const summaries = summarizeIncrementalLayoutReplays(measuredReplays);
		return [
			formatIncrementalLayoutSummaries(input.scenario.name, summaries),
			formatIncrementalLayoutCheckpointSummaries(
				input.scenario.name,
				summarizeIncrementalLayoutCheckpoints(measuredReplays),
			),
		];
	});
	// eslint-disable-next-line no-console -- this benchmark exists to print a machine-readable report.
	console.info(
		`Incremental stage results (scenario,bucket-or-checkpoint,stage,p50Ms,p95Ms,maxMs,slowest insertion for buckets)\n${reports.join('\n')}`,
	);
}

describe('incremental layout replay', () => {
	bench('stage report generated from three measured replays per topology', () => undefined, {
		iterations: 1,
		warmupIterations: 0,
		warmupTime: 0,
		time: 0,
		setup: generateIncrementalLayoutReport,
	});
});
