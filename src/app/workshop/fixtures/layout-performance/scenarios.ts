import { BinaryTreeScenarioBuilder } from './builders/binary-tree-scenario';
import { DisconnectedComponentsScenarioBuilder } from './builders/disconnected-components-scenario';
import { GroupRelationsScenarioBuilder } from './builders/group-relations-scenario';
import { JunctionHeavyScenarioBuilder } from './builders/junction-heavy-scenario';
import { LongQueueScenarioBuilder } from './builders/long-queue-scenario';
import { NestedSubgroupsScenarioBuilder } from './builders/nested-subgroups-scenario';
import { RepeatedDiamondsScenarioBuilder } from './builders/repeated-diamonds-scenario';
import { ShallowGroupsScenarioBuilder } from './builders/shallow-groups-scenario';
import { SubgroupsScenarioBuilder } from './builders/subgroups-scenario';
import { UnbalancedRandomScenarioBuilder } from './builders/unbalanced-random-scenario';
import { UnbalancedScenarioBuilder } from './builders/unbalanced-scenario';
import { WideBipartiteLayersScenarioBuilder } from './builders/wide-bipartite-layers-scenario';
import { LAYOUT_PERFORMANCE_SCENARIO_NAMES } from './scenario-name';
import type { NamedLayoutPerformanceScenario } from './scenario-types';

export const LAYOUT_PERFORMANCE_SCENARIOS = [
	{ name: 'long-queue', createBuilder: () => new LongQueueScenarioBuilder() },
	{ name: 'binary-tree', createBuilder: () => new BinaryTreeScenarioBuilder() },
	{ name: 'unbalanced', createBuilder: () => new UnbalancedScenarioBuilder() },
	{ name: 'unbalanced-random', createBuilder: () => new UnbalancedRandomScenarioBuilder() },
	{ name: 'subgroups', createBuilder: () => new SubgroupsScenarioBuilder() },
	{ name: 'nested-subgroups', createBuilder: () => new NestedSubgroupsScenarioBuilder() },
	{
		name: 'wide-bipartite-layers',
		createBuilder: () => new WideBipartiteLayersScenarioBuilder(),
	},
	{ name: 'repeated-diamonds', createBuilder: () => new RepeatedDiamondsScenarioBuilder() },
	{
		name: 'disconnected-components',
		createBuilder: () => new DisconnectedComponentsScenarioBuilder(),
	},
	{ name: 'junction-heavy', createBuilder: () => new JunctionHeavyScenarioBuilder() },
	{ name: 'group-relations', createBuilder: () => new GroupRelationsScenarioBuilder() },
	{ name: 'shallow-groups', createBuilder: () => new ShallowGroupsScenarioBuilder() },
] as const satisfies readonly NamedLayoutPerformanceScenario[];

const registeredNames = LAYOUT_PERFORMANCE_SCENARIOS.map(({ name }) => name);
if (
	registeredNames.length !== LAYOUT_PERFORMANCE_SCENARIO_NAMES.length ||
	registeredNames.some((name, index) => name !== LAYOUT_PERFORMANCE_SCENARIO_NAMES[index])
) {
	throw new Error('Layout performance scenario catalog is incomplete or out of order');
}
