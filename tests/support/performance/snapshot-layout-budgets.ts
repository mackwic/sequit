import {
	LAYOUT_PERFORMANCE_NODE_COUNTS,
	type LayoutPerformanceNodeCount,
} from '../../../src/app/workshop/fixtures/layout-performance/node-counts';
import {
	LAYOUT_PERFORMANCE_SCENARIO_NAMES,
	type LayoutPerformanceScenarioName,
} from '../../../src/app/workshop/fixtures/layout-performance/scenario-name';

type SnapshotLayoutBudgets = Readonly<
	Record<LayoutPerformanceScenarioName, Readonly<Record<LayoutPerformanceNodeCount, number>>>
>;

const SNAPSHOT_LAYOUT_BUDGETS_MS = {
	'long-queue': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'binary-tree': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	unbalanced: { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'unbalanced-random': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	subgroups: { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'nested-subgroups': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 205 },
	'wide-bipartite-layers': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'repeated-diamonds': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'disconnected-components': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'junction-heavy': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'group-relations': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
	'shallow-groups': { 10: 10, 19: 10, 50: 30, 100: 50, 1000: 100 },
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
): number {
	return SNAPSHOT_LAYOUT_BUDGETS_MS[scenario][nodeCount];
}
