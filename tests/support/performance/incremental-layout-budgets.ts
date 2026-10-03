import {
	LAYOUT_PERFORMANCE_SCENARIO_NAMES,
	type LayoutPerformanceScenarioName,
} from '../../../src/app/workshop/fixtures/layout-performance/scenario-name';
import { LAYOUT_PERFORMANCE_BUDGET_HEADROOM } from './layout-performance-policy';

export const INCREMENTAL_LAYOUT_GROWTH_BUCKETS = [
	{ name: '1-9', minimumNodeIndex: 1, maximumNodeIndex: 9 },
	{ name: '10-19', minimumNodeIndex: 10, maximumNodeIndex: 19 },
	{ name: '20-49', minimumNodeIndex: 20, maximumNodeIndex: 49 },
	{ name: '50-99', minimumNodeIndex: 50, maximumNodeIndex: 99 },
	{ name: '100-999', minimumNodeIndex: 100, maximumNodeIndex: 999 },
] as const;

export type IncrementalLayoutGrowthBucketName =
	(typeof INCREMENTAL_LAYOUT_GROWTH_BUCKETS)[number]['name'];

type IncrementalLayoutBudgets = Readonly<
	Record<
		LayoutPerformanceScenarioName,
		Readonly<Record<IncrementalLayoutGrowthBucketName, number | undefined>>
	>
>;

const INCREMENTAL_LAYOUT_BUDGETS_MS = {
	'long-queue': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 8 },
	'binary-tree': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 9 },
	unbalanced: { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 9 },
	'unbalanced-random': { '1-9': 5, '10-19': 7, '20-49': 7, '50-99': 5, '100-999': 12 },
	subgroups: { '1-9': 5, '10-19': 7, '20-49': 13, '50-99': 5, '100-999': 25 },
	'nested-subgroups': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 200 },
	// 50-99 raised for D-05 (user decision 2026-10-02: correction before performance): worst
	// p95 29.278 ms in two calm passes on 2026-10-03, against a 6 ms ceiling calibrated at 3.520 ms.
	// 1-9 raised when wave 2 met main (same decision): worst p95 11.220 ms in three passes against
	// 2.520 ms on main 6e992f3d.
	'wide-bipartite-layers': {
		'1-9': 20,
		'10-19': 9,
		'20-49': 5,
		'50-99': 45,
		'100-999': 195,
	},
	'repeated-diamonds': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 10 },
	'disconnected-components': {
		'1-9': 5,
		'10-19': 5,
		'20-49': 5,
		'50-99': 5,
		'100-999': 7,
	},
	'junction-heavy': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 19 },
	'group-relations': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 10 },
	'shallow-groups': { '1-9': 5, '10-19': 5, '20-49': 10, '50-99': 5, '100-999': 25 },
	'lane-allocations': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 20 },
	'lane-allocations-dense': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 10, '100-999': 70 },
} as const satisfies IncrementalLayoutBudgets;

function assertExactKeys(
	label: string,
	actual: readonly string[],
	expected: readonly string[],
): void {
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new Error(`${label} keys do not match the shared incremental matrix`);
	}
}

assertExactKeys(
	'Incremental layout scenario',
	Object.keys(INCREMENTAL_LAYOUT_BUDGETS_MS),
	LAYOUT_PERFORMANCE_SCENARIO_NAMES,
);
const expectedBucketKeys = INCREMENTAL_LAYOUT_GROWTH_BUCKETS.map(({ name }) => name);
for (const scenario of LAYOUT_PERFORMANCE_SCENARIO_NAMES) {
	assertExactKeys(
		`${scenario} growth-bucket`,
		Object.keys(INCREMENTAL_LAYOUT_BUDGETS_MS[scenario]),
		expectedBucketKeys,
	);
}

export function incrementalLayoutBudgetMs(
	scenario: LayoutPerformanceScenarioName,
	bucket: IncrementalLayoutGrowthBucketName,
): number | undefined {
	return INCREMENTAL_LAYOUT_BUDGETS_MS[scenario][bucket] * LAYOUT_PERFORMANCE_BUDGET_HEADROOM;
}
