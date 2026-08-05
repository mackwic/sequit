import type { LogicDocument } from '../../src/lib/document/logic-document';
import type {
	LayoutPerformanceInsertion,
	NamedLayoutPerformanceScenario,
} from '../scenarios/layout-performance/scenario-types';
import {
	INCREMENTAL_LAYOUT_GROWTH_BUCKETS,
	type IncrementalLayoutGrowthBucketName,
} from './incremental-layout-budgets';
import {
	type IncrementalLayoutTiming,
	timeLayoutPerformanceInsertion,
} from './incremental-layout-timing';
import {
	LAYOUT_PERFORMANCE_NODE_COUNTS,
	type LayoutPerformanceNodeCount,
} from './layout-performance-policy';
import { maximum, median, percentile } from './performance-statistics';

export const INCREMENTAL_LAYOUT_TIMING_STAGES = [
	'documentUpdateMs',
	'validationMs',
	'graphCreationMs',
	'rankingMs',
	'measurementProjectionMs',
	'syntheticMeasurementsMs',
	'synchronousProjectionMs',
	'layoutMs',
	'totalMs',
] as const satisfies readonly (keyof IncrementalLayoutTiming)[];

type IncrementalLayoutTimingStage = (typeof INCREMENTAL_LAYOUT_TIMING_STAGES)[number];

export interface IncrementalLayoutReplayInput {
	readonly scenario: NamedLayoutPerformanceScenario;
	readonly nodeCount: number;
	readonly initialDocument: LogicDocument;
	readonly insertions: readonly LayoutPerformanceInsertion[];
}

interface IncrementalLayoutInsertionResult {
	readonly nodeIndex: number;
	readonly timing: IncrementalLayoutTiming;
}

export interface IncrementalLayoutReplayResult {
	readonly scenarioName: NamedLayoutPerformanceScenario['name'];
	readonly nodeCount: number;
	readonly insertions: readonly IncrementalLayoutInsertionResult[];
}

interface IncrementalLayoutStageSummary {
	readonly p50: number;
	readonly p95: number;
	readonly maximum: number;
}

export interface IncrementalLayoutBucketSummary {
	readonly bucket: IncrementalLayoutGrowthBucketName;
	readonly sampleCount: number;
	readonly stages: Readonly<Record<IncrementalLayoutTimingStage, IncrementalLayoutStageSummary>>;
	readonly slowestInsertion: IncrementalLayoutInsertionResult;
}

export interface IncrementalLayoutCheckpointSummary {
	readonly nodeCount: LayoutPerformanceNodeCount;
	readonly sampleCount: number;
	readonly stages: Readonly<Record<IncrementalLayoutTimingStage, IncrementalLayoutStageSummary>>;
	readonly slowestInsertion: IncrementalLayoutInsertionResult;
}

export function prepareIncrementalLayoutReplay(
	scenario: NamedLayoutPerformanceScenario,
	nodeCount: number,
): IncrementalLayoutReplayInput {
	const builder = scenario.createBuilder();
	const insertions = builder.buildInsertions(nodeCount);
	return Object.freeze({
		scenario,
		nodeCount,
		initialDocument: builder.buildInitialDocument(),
		insertions,
	});
}

export async function replayIncrementalLayout(
	input: IncrementalLayoutReplayInput,
): Promise<IncrementalLayoutReplayResult> {
	let document = input.initialDocument;
	const results: IncrementalLayoutInsertionResult[] = [];
	for (const insertion of input.insertions) {
		const result = await timeLayoutPerformanceInsertion(document, insertion);
		document = result.document;
		results.push({ nodeIndex: result.nodeIndex, timing: result.timing });
	}
	return { scenarioName: input.scenario.name, nodeCount: input.nodeCount, insertions: results };
}

function stageSummary(
	insertions: readonly IncrementalLayoutInsertionResult[],
	stage: IncrementalLayoutTimingStage,
): IncrementalLayoutStageSummary {
	const values = insertions.map(({ timing }) => timing[stage]);
	return { p50: median(values), p95: percentile(values, 95), maximum: maximum(values) };
}

function summarizeSamples(samples: readonly IncrementalLayoutInsertionResult[]): {
	readonly sampleCount: number;
	readonly stages: Readonly<Record<IncrementalLayoutTimingStage, IncrementalLayoutStageSummary>>;
	readonly slowestInsertion: IncrementalLayoutInsertionResult;
} {
	const slowestInsertion = samples.reduce((slowest, insertion) => {
		if (insertion.timing.totalMs > slowest.timing.totalMs) return insertion;
		return slowest;
	});
	const stages = {
		documentUpdateMs: stageSummary(samples, 'documentUpdateMs'),
		validationMs: stageSummary(samples, 'validationMs'),
		graphCreationMs: stageSummary(samples, 'graphCreationMs'),
		rankingMs: stageSummary(samples, 'rankingMs'),
		measurementProjectionMs: stageSummary(samples, 'measurementProjectionMs'),
		syntheticMeasurementsMs: stageSummary(samples, 'syntheticMeasurementsMs'),
		synchronousProjectionMs: stageSummary(samples, 'synchronousProjectionMs'),
		layoutMs: stageSummary(samples, 'layoutMs'),
		totalMs: stageSummary(samples, 'totalMs'),
	};
	return { sampleCount: samples.length, stages, slowestInsertion };
}

export function summarizeIncrementalLayoutReplays(
	replays: readonly IncrementalLayoutReplayResult[],
): readonly IncrementalLayoutBucketSummary[] {
	if (replays.length === 0) throw new Error('Cannot summarize zero incremental replays');
	const insertions = replays.flatMap((replay) => replay.insertions);

	return INCREMENTAL_LAYOUT_GROWTH_BUCKETS.map((bucket) => {
		const samples = insertions.filter(
			({ nodeIndex }) =>
				nodeIndex >= bucket.minimumNodeIndex && nodeIndex <= bucket.maximumNodeIndex,
		);
		if (samples.length === 0) throw new Error(`No samples for incremental bucket ${bucket.name}`);
		return { bucket: bucket.name, ...summarizeSamples(samples) };
	});
}

export function summarizeIncrementalLayoutCheckpoints(
	replays: readonly IncrementalLayoutReplayResult[],
): readonly IncrementalLayoutCheckpointSummary[] {
	if (replays.length === 0) throw new Error('Cannot summarize zero incremental replays');
	const insertions = replays.flatMap((replay) => replay.insertions);
	return LAYOUT_PERFORMANCE_NODE_COUNTS.map((nodeCount) => {
		const samples = insertions.filter(({ nodeIndex }) => nodeIndex === nodeCount - 1);
		if (samples.length === 0) throw new Error(`No samples for ${nodeCount}-node checkpoint`);
		return { nodeCount, ...summarizeSamples(samples) };
	});
}

export function formatIncrementalLayoutSummaries(
	scenarioName: NamedLayoutPerformanceScenario['name'],
	summaries: readonly IncrementalLayoutBucketSummary[],
): string {
	return summaries
		.flatMap((summary) => {
			const slowestStages = INCREMENTAL_LAYOUT_TIMING_STAGES.map(
				(stage) => `${stage}=${summary.slowestInsertion.timing[stage].toFixed(3)}`,
			).join(' ');
			return INCREMENTAL_LAYOUT_TIMING_STAGES.map((stage) => {
				const statistics = summary.stages[stage];
				return `${scenarioName},${summary.bucket},${stage},${statistics.p50.toFixed(3)},${statistics.p95.toFixed(3)},${statistics.maximum.toFixed(3)},slowestNodeIndex=${summary.slowestInsertion.nodeIndex} ${slowestStages}`;
			});
		})
		.join('\n');
}

export function formatIncrementalLayoutCheckpointSummaries(
	scenarioName: NamedLayoutPerformanceScenario['name'],
	summaries: readonly IncrementalLayoutCheckpointSummary[],
): string {
	return summaries
		.flatMap((summary) =>
			INCREMENTAL_LAYOUT_TIMING_STAGES.map((stage) => {
				const statistics = summary.stages[stage];
				return `${scenarioName},nodes=${summary.nodeCount},${stage},${statistics.p50.toFixed(3)},${statistics.p95.toFixed(3)},${statistics.maximum.toFixed(3)}`;
			}),
		)
		.join('\n');
}
