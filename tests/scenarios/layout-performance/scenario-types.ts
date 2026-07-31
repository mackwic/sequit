import type {
	LogicDocument,
	LogicGroup,
	LogicJunction,
	LogicNode,
	LogicRelation,
} from '../../../src/lib/document/logic-document';
import type { LogicGraph } from '../../../src/lib/graph/create-graph';
import type { TopologicalRanks } from '../../../src/lib/graph/topological-ranks';
import type { LayoutMeasurements } from '../../../src/lib/layout/layout-graph';
import type { LayoutPerformanceScenarioBuilder } from './layout-performance-scenario-builder';
import type { LayoutPerformanceScenarioName } from './scenario-name';

export type NodeRank = readonly string[];
export type NodeRanks = readonly NodeRank[];

export interface LayoutPerformanceSnapshot {
	readonly name: LayoutPerformanceScenarioName;
	readonly nodeCount: number;
	readonly document: LogicDocument;
	readonly nodeRanks: NodeRanks;
	readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LayoutPerformanceInsertion {
	readonly name: LayoutPerformanceScenarioName;
	readonly nodeIndex: number;
	readonly nodeRank: number;
	readonly node: LogicNode;
	readonly groups: readonly LogicGroup[];
	readonly junctions: readonly LogicJunction[];
	readonly addedRelations: readonly LogicRelation[];
	readonly removedRelationIds: readonly string[];
}

export interface NamedLayoutPerformanceScenario {
	readonly name: LayoutPerformanceScenarioName;
	readonly createBuilder: () => LayoutPerformanceScenarioBuilder;
}

export interface PreparedLayoutPerformanceScenario extends LayoutPerformanceSnapshot {
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
}
