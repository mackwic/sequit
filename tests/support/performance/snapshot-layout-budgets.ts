import {
	LAYOUT_PERFORMANCE_NODE_COUNTS,
	type LayoutPerformanceNodeCount,
} from '../../../src/app/workshop/fixtures/layout-performance/node-counts';
import {
	LAYOUT_PERFORMANCE_SCENARIO_NAMES,
	type LayoutPerformanceScenarioName,
} from '../../../src/app/workshop/fixtures/layout-performance/scenario-name';
import { LAYOUT_PERFORMANCE_BUDGET_HEADROOM } from './layout-performance-policy';

type SnapshotLayoutBudgets = Readonly<
	Record<
		LayoutPerformanceScenarioName,
		Readonly<Record<LayoutPerformanceNodeCount, number | undefined>>
	>
>;

const SNAPSHOT_LAYOUT_BUDGETS_MS = {
	'long-queue': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'binary-tree': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	unbalanced: { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'unbalanced-random': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	// 19 raised for D-04 (user decision 2026-10-02: correction before performance): every routable
	// rank order is scored on real routes, up to twelve pipelines instead of one or two. Calm
	// recalibration on 2026-10-03 (worst median 11.359 ms) keeps 20 ms and returns 10 to 10 ms.
	subgroups: { 10: 10, 19: 20, 50: 30, 100: 50, 1000: 100 },
	'nested-subgroups': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 205 },
	// 1000 raised for D-05 (same user decision): rail untangling scores every pair of runs in a
	// channel; calm worst median 406.46 ms on 2026-10-03 against 137 ms on the wave base.
	'wide-bipartite-layers': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 610 },
	'repeated-diamonds': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'disconnected-components': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'junction-heavy': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'group-relations': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'shallow-groups': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'lane-allocations': { 10: 5, 19: 5, 50: 5, 100: 5, 1000: 10 },
	'lane-allocations-dense': { 10: 5, 19: 5, 50: 5, 100: 5, 1000: 65 },
} as const satisfies SnapshotLayoutBudgets;

function assertExactKeys(
	label: string,
	actual: readonly string[],
	expected: readonly string[],
): void {
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new Error(`${label} keys do not match the shared performance matrix`);
	}
}

assertExactKeys(
	'Snapshot layout scenario',
	Object.keys(SNAPSHOT_LAYOUT_BUDGETS_MS),
	LAYOUT_PERFORMANCE_SCENARIO_NAMES,
);

const expectedNodeCountKeys = LAYOUT_PERFORMANCE_NODE_COUNTS.map(String);
for (const scenario of LAYOUT_PERFORMANCE_SCENARIO_NAMES) {
	assertExactKeys(
		`${scenario} node-count`,
		Object.keys(SNAPSHOT_LAYOUT_BUDGETS_MS[scenario]),
		expectedNodeCountKeys,
	);
}

export function layoutPerformanceBudgetMs(
	scenario: LayoutPerformanceScenarioName,
	nodeCount: LayoutPerformanceNodeCount,
): number | undefined {
	return SNAPSHOT_LAYOUT_BUDGETS_MS[scenario][nodeCount] * LAYOUT_PERFORMANCE_BUDGET_HEADROOM;
}
