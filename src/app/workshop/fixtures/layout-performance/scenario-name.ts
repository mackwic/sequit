export const LAYOUT_PERFORMANCE_SCENARIO_NAMES = [
	'long-queue',
	'binary-tree',
	'unbalanced',
	'unbalanced-random',
	'subgroups',
	'nested-subgroups',
	'wide-bipartite-layers',
	'repeated-diamonds',
	'disconnected-components',
	'junction-heavy',
	'group-relations',
	'shallow-groups',
	'lane-allocations',
	'lane-allocations-dense',
] as const;

export type LayoutPerformanceScenarioName = (typeof LAYOUT_PERFORMANCE_SCENARIO_NAMES)[number];
