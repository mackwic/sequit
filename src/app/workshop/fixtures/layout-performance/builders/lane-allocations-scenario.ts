import {
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	type LogicNode,
	type LogicRelation,
} from '../../../../../lib/core/document/logic-document';
import { orderKey } from '../../../../../lib/core/document/order-key';
import { applyLayoutPerformanceInsertion } from '../apply-layout-performance-insertion';
import type { LayoutPerformanceInsertion, LayoutPerformanceSnapshot } from '../scenario-types';

const ROUTE_RELATIONS: readonly LogicRelation[] = [
	{ id: 'route-a1-b1', from: 'node-0000000000000000', to: 'node-0000000000000001' },
	{ id: 'route-a1-b2', from: 'node-0000000000000000', to: 'node-0000000000000003' },
	{ id: 'route-a2-b1', from: 'node-0000000000000002', to: 'node-0000000000000001' },
	{ id: 'route-a2-b2', from: 'node-0000000000000002', to: 'node-0000000000000003' },
];

function emptyDocument(): LogicDocument {
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'layout-performance-lane-allocations',
		title: 'Layout performance: lane allocations',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'A', label: 'A', layoutOrder: orderKey('a0') },
				{ id: 'B', label: 'B', layoutOrder: orderKey('a1') },
				{ id: 'C', label: 'C', layoutOrder: orderKey('a2') },
			],
		},
		natures: [{ id: 'performance-node', label: 'Performance node', color: '#2f6b4f' }],
		groups: [],
		nodes: [],
		junctions: [],
		relations: [],
	};
}

function nodeId(index: number): string {
	return `node-${index.toString().padStart(16, '0')}`;
}

function node(index: number): LogicNode {
	const base = {
		kind: EndpointKind.Node,
		id: nodeId(index),
		natureId: 'performance-node',
		markdown: `Node ${index}`,
		layoutOrder: orderKey(`a${index.toString().padStart(16, '0')}1`),
	} as const;
	if (index >= 4) return { ...base, laneId: 'C' };
	let laneId = 'A';
	if (index % 2 !== 0) laneId = 'B';
	return { ...base, laneId };
}
function nodeRank(index: number): number {
	if (index === 1 || index === 3) return 1;
	return 0;
}

function addedRelations(nodeIndex: number): readonly LogicRelation[] {
	if (nodeIndex === 3) return ROUTE_RELATIONS;
	return [];
}

function insertions(nodeCount: number): readonly LayoutPerformanceInsertion[] {
	if (!Number.isSafeInteger(nodeCount) || nodeCount <= 0)
		throw new Error(`Node count must be a positive integer: ${nodeCount}`);
	return Array.from({ length: nodeCount }, (_, nodeIndex) => ({
		name: 'lane-allocations',
		nodeIndex,
		nodeRank: nodeRank(nodeIndex),
		node: node(nodeIndex),
		groups: [],
		junctions: [],
		addedRelations: addedRelations(nodeIndex),
		removedRelationIds: [],
	}));
}

export class LaneAllocationsScenarioBuilder {
	readonly name = 'lane-allocations' as const;

	buildInitialDocument(): LogicDocument {
		return emptyDocument();
	}

	buildSnapshot(nodeCount: number): LayoutPerformanceSnapshot {
		const additions = insertions(nodeCount);
		let document = emptyDocument();
		const nodeRanks: string[][] = [];
		for (const addition of additions) {
			document = applyLayoutPerformanceInsertion(document, addition);
			(nodeRanks[addition.nodeRank] ??= []).push(addition.node.id);
		}
		return {
			name: this.name,
			nodeCount,
			document,
			nodeRanks,
			metadata: {
				laneCount: 3,
				routeCount: ROUTE_RELATIONS.length,
			},
		};
	}

	buildInsertions(nodeCount: number): readonly LayoutPerformanceInsertion[] {
		return insertions(nodeCount);
	}
}
