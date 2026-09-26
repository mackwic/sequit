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

export enum LaneAllocationsScenarioName {
	Sentinel = 'lane-allocations',
	Dense = 'lane-allocations-dense',
}

const ROUTE_RELATIONS: readonly LogicRelation[] = [
	{ id: 'route-a1-b1', from: 'node-0000000000000000', to: 'node-0000000000000001' },
	{ id: 'route-a1-b2', from: 'node-0000000000000000', to: 'node-0000000000000003' },
	{ id: 'route-a2-b1', from: 'node-0000000000000002', to: 'node-0000000000000001' },
	{ id: 'route-a2-b2', from: 'node-0000000000000002', to: 'node-0000000000000003' },
];

function emptyDocument(dense: boolean): LogicDocument {
	let id = 'layout-performance-lane-allocations';
	let title = 'Layout performance: lane allocations';
	if (dense) {
		id = 'layout-performance-lane-allocations-dense';
		title = 'Layout performance: growing lane routes';
	}
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id,
		title,
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

function node(index: number, dense: boolean): LogicNode {
	const base = {
		kind: EndpointKind.Node,
		id: nodeId(index),
		natureId: 'performance-node',
		markdown: `Node ${index}`,
		layoutOrder: orderKey(`a${index.toString().padStart(16, '0')}1`),
	} as const;
	let laneId = 'A';
	if (dense) {
		if (index % 3 === 1) laneId = 'B';
		if (index % 3 === 2) laneId = 'C';
		return { ...base, laneId };
	}
	if (index >= 4) return { ...base, laneId: 'C' };
	if (index % 2 !== 0) laneId = 'B';
	return { ...base, laneId };
}
function nodeRank(index: number, dense: boolean): number {
	if (dense) {
		if (index < 3) return 0;
		if (index % 20 === 3) return 1;
		return 0;
	}
	if (index === 1 || index === 3) return 1;
	return 0;
}

function addedRelations(nodeIndex: number, dense: boolean): readonly LogicRelation[] {
	if (dense && nodeIndex >= 3) {
		if (nodeIndex % 20 !== 3) return [];
		return [
			{
				id: `route-${nodeId(nodeIndex - 1)}-${nodeId(nodeIndex)}`,
				from: nodeId(nodeIndex - 1),
				to: nodeId(nodeIndex),
			},
		];
	}
	if (nodeIndex === 3) return ROUTE_RELATIONS;
	return [];
}

function insertions(nodeCount: number, dense: boolean): readonly LayoutPerformanceInsertion[] {
	if (!Number.isSafeInteger(nodeCount) || nodeCount <= 0)
		throw new Error(`Node count must be a positive integer: ${nodeCount}`);
	let name: LaneAllocationsScenarioName = LaneAllocationsScenarioName.Sentinel;
	if (dense) name = LaneAllocationsScenarioName.Dense;
	return Array.from({ length: nodeCount }, (_, nodeIndex) => ({
		name,
		nodeIndex,
		nodeRank: nodeRank(nodeIndex, dense),
		node: node(nodeIndex, dense),
		groups: [],
		junctions: [],
		addedRelations: addedRelations(nodeIndex, dense),
		removedRelationIds: [],
	}));
}

export class LaneAllocationsScenarioBuilder {
	constructor(readonly name: LaneAllocationsScenarioName = LaneAllocationsScenarioName.Sentinel) {}

	private get dense(): boolean {
		return this.name === LaneAllocationsScenarioName.Dense;
	}

	buildInitialDocument(): LogicDocument {
		return emptyDocument(this.dense);
	}

	buildSnapshot(nodeCount: number): LayoutPerformanceSnapshot {
		const additions = insertions(nodeCount, this.dense);
		let document = emptyDocument(this.dense);
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
				routeCount: document.relations.length,
			},
		};
	}

	buildInsertions(nodeCount: number): readonly LayoutPerformanceInsertion[] {
		return insertions(nodeCount, this.dense);
	}
}
