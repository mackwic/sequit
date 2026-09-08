import type {
	LogicDocument,
	LogicGroup,
	LogicJunction,
	LogicNode,
	LogicRelation,
} from '../../../../lib/core/document/logic-document';
import type { LayoutPerformanceScenarioName } from './scenario-name';

type NodeRank = readonly string[];
type NodeRanks = readonly NodeRank[];

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
	readonly createBuilder: () => {
		buildInitialDocument(): LogicDocument;
		buildSnapshot(nodeCount: number): LayoutPerformanceSnapshot;
		buildInsertions(nodeCount: number): readonly LayoutPerformanceInsertion[];
	};
}
