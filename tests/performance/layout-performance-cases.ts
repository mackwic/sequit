import {
	LAYOUT_PERFORMANCE_NODE_COUNTS,
	type LayoutPerformanceNodeCount,
} from '../../src/lib/fixtures/layout-performance/node-counts';
import type { NamedLayoutPerformanceScenario } from '../../src/lib/fixtures/layout-performance/scenario-types';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../src/lib/fixtures/layout-performance/scenarios';
import { prepareLayoutPerformanceScenario } from '../scenarios/layout-performance/prepare-layout-performance-scenario';
import type { PreparedLayoutPerformanceScenario } from '../scenarios/layout-performance/scenario-types';

interface LayoutPerformanceWorkloadMetadata {
	readonly requestedNodes: number;
	readonly groups: number;
	readonly junctions: number;
	readonly rankableEndpoints: number;
	readonly relations: number;
	readonly adjacencyEdges: number;
}

export interface LayoutPerformanceCase {
	readonly caseName: string;
	readonly scenario: NamedLayoutPerformanceScenario;
	readonly nodeCount: LayoutPerformanceNodeCount;
	readonly prepared: PreparedLayoutPerformanceScenario;
	readonly workload: LayoutPerformanceWorkloadMetadata;
}

function createCase(
	scenario: NamedLayoutPerformanceScenario,
	nodeCount: LayoutPerformanceNodeCount,
): LayoutPerformanceCase {
	const prepared = prepareLayoutPerformanceScenario(scenario, nodeCount);
	const workload = Object.freeze({
		requestedNodes: nodeCount,
		groups: prepared.document.groups.length,
		junctions: prepared.document.junctions.length,
		rankableEndpoints: prepared.graph.rankableEndpointIds.length,
		relations: prepared.document.relations.length,
		adjacencyEdges: [...prepared.graph.outgoingByEndpointId.values()].reduce(
			(total, targets) => total + targets.length,
			0,
		),
	});
	const caseName = `${scenario.name}/nodes=${nodeCount} (groups=${workload.groups}, junctions=${workload.junctions}, rankable=${workload.rankableEndpoints}, relations=${workload.relations}, adjacency=${workload.adjacencyEdges})`;

	return Object.freeze({ caseName, scenario, nodeCount, prepared, workload });
}

const cases = Object.freeze(
	LAYOUT_PERFORMANCE_SCENARIOS.flatMap((scenario) =>
		LAYOUT_PERFORMANCE_NODE_COUNTS.map((nodeCount) => createCase(scenario, nodeCount)),
	),
);

export function layoutPerformanceCases(): readonly LayoutPerformanceCase[] {
	return cases;
}
