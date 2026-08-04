import {
	LAYOUT_PERFORMANCE_SCENARIO_NAMES,
	type LayoutPerformanceScenarioName,
} from '../scenarios/layout-performance/scenario-name';

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
	Record<LayoutPerformanceScenarioName, Readonly<Record<IncrementalLayoutGrowthBucketName, number>>>
>;

export const INCREMENTAL_LAYOUT_BUDGETS_MS = {
	'long-queue': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 5 },
	'binary-tree': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 5 },
	unbalanced: { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 5 },
	'unbalanced-random': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 5 },
	subgroups: { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 5 },
	'nested-subgroups': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 200 },
	'wide-bipartite-layers': {
		'1-9': 5,
		'10-19': 5,
		'20-49': 5,
		'50-99': 5,
		'100-999': 70,
	},
	'repeated-diamonds': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 5 },
	'disconnected-components': {
		'1-9': 5,
		'10-19': 5,
		'20-49': 5,
		'50-99': 5,
		'100-999': 5,
	},
	'junction-heavy': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 10 },
	'group-relations': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 5 },
	'shallow-groups': { '1-9': 5, '10-19': 5, '20-49': 5, '50-99': 5, '100-999': 10 },
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
): number {
	return INCREMENTAL_LAYOUT_BUDGETS_MS[scenario][bucket];
}
