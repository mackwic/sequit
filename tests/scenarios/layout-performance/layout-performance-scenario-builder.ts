import {
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNode,
	type LogicRelation,
} from '../../../src/lib/document/logic-document';
import { applyLayoutPerformanceInsertion } from './apply-layout-performance-insertion';
import type { LayoutPerformanceScenarioName } from './scenario-name';
import type { LayoutPerformanceInsertion, LayoutPerformanceSnapshot } from './scenario-types';

const ID_WIDTH = 16;

function initialDocument(name: LayoutPerformanceScenarioName): LogicDocument {
	return {
		id: `layout-performance-${name}`,
		title: `Layout performance: ${name}`,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'performance-node', label: 'Performance node', color: '#2f6b4f' }],
		groups: [],
		nodes: [],
		junctions: [],
		relations: [],
	};
}

export abstract class LayoutPerformanceScenarioBuilder {
	abstract readonly name: LayoutPerformanceScenarioName;

	private document: LogicDocument = initialDocument('long-queue');
	private readonly ranks: string[][] = [];

	buildInitialDocument(): LogicDocument {
		this.reset();
		return this.copyDocument();
	}

	buildSnapshot(nodeCount: number): LayoutPerformanceSnapshot {
		this.assertNodeCount(nodeCount);
		this.reset();
		while (this.document.nodes.length < nodeCount) this.insertNextNode();
		return this.snapshot();
	}

	buildInsertions(nodeCount: number): readonly LayoutPerformanceInsertion[] {
		this.assertNodeCount(nodeCount);
		this.reset();
		return Array.from({ length: nodeCount }, () => this.insertNextNode());
	}

	protected abstract insertNode(nodeIndex: number): LayoutPerformanceInsertion;

	protected metadata(): Readonly<Record<string, unknown>> {
		return {};
	}

	protected resetTopology(): void {
		return;
	}

	protected nodeId(index: number): string {
		return `node-${this.numericId(index)}`;
	}

	protected groupId(index: number): string {
		return `group-${this.numericId(index)}`;
	}

	protected junctionId(index: number): string {
		return `junction-${this.numericId(index)}`;
	}

	protected relationId(from: string, to: string): string {
		return `relation-${from}-to-${to}`;
	}

	protected node(index: number, groupId?: string): LogicNode {
		const node: LogicNode = {
			id: this.nodeId(index),
			natureId: 'performance-node',
			markdown: `Node ${index}`,
		};
		if (groupId === undefined) return node;
		return { ...node, groupId };
	}

	protected group(index: number, parentGroupId?: string): LogicGroup {
		const group: LogicGroup = {
			id: this.groupId(index),
			label: `Group ${index}`,
		};
		if (parentGroupId === undefined) return group;
		return { ...group, groupId: parentGroupId };
	}

	protected junction(index: number): LogicJunction {
		return { id: this.junctionId(index), operator: JunctionOperator.Xor };
	}

	protected relation(from: string, to: string): LogicRelation {
		return { id: this.relationId(from, to), from, to };
	}

	protected insertion(
		nodeIndex: number,
		nodeRank: number,
		options: {
			readonly node?: LogicNode;
			readonly groups?: readonly LogicGroup[];
			readonly junctions?: readonly LogicJunction[];
			readonly addedRelations?: readonly LogicRelation[];
			readonly removedRelationIds?: readonly string[];
		} = {},
	): LayoutPerformanceInsertion {
		return {
			name: this.name,
			nodeIndex,
			nodeRank,
			node: options.node ?? this.node(nodeIndex),
			groups: options.groups ?? [],
			junctions: options.junctions ?? [],
			addedRelations: options.addedRelations ?? [],
			removedRelationIds: options.removedRelationIds ?? [],
		};
	}

	private numericId(index: number): string {
		if (!Number.isSafeInteger(index) || index < 0)
			throw new Error(`Invalid entity index: ${index}`);
		return index.toString().padStart(ID_WIDTH, '0');
	}

	private assertNodeCount(nodeCount: number): void {
		if (!Number.isSafeInteger(nodeCount) || nodeCount <= 0) {
			throw new Error(`Node count must be a positive integer: ${nodeCount}`);
		}
	}

	private reset(): void {
		this.document = initialDocument(this.name);
		this.ranks.length = 0;
		this.resetTopology();
	}

	private insertNextNode(): LayoutPerformanceInsertion {
		const nodeIndex = this.document.nodes.length;
		const insertion = this.insertNode(nodeIndex);
		if (insertion.name !== this.name || insertion.nodeIndex !== nodeIndex) {
			throw new Error(`Invalid insertion identity for ${this.name} at node ${nodeIndex}`);
		}
		if (insertion.node.id !== this.nodeId(nodeIndex)) {
			throw new Error(`Insertion must add stable node id ${this.nodeId(nodeIndex)}`);
		}

		const beforeIds = new Set([
			...this.document.groups.map(({ id }) => id),
			...this.document.nodes.map(({ id }) => id),
			...this.document.junctions.map(({ id }) => id),
			...this.document.relations.map(({ id }) => id),
		]);
		for (const entity of [
			insertion.node,
			...insertion.groups,
			...insertion.junctions,
			...insertion.addedRelations,
		]) {
			if (beforeIds.has(entity.id)) throw new Error(`Duplicate insertion id: ${entity.id}`);
			beforeIds.add(entity.id);
		}

		this.document = applyLayoutPerformanceInsertion(this.document, insertion);
		(this.ranks[insertion.nodeRank] ??= []).push(insertion.node.id);
		return insertion;
	}

	private snapshot(): LayoutPerformanceSnapshot {
		return {
			name: this.name,
			nodeCount: this.document.nodes.length,
			document: this.copyDocument(),
			nodeRanks: this.ranks.map((rank) => [...rank]),
			metadata: { ...this.metadata() },
		};
	}

	private copyDocument(): LogicDocument {
		return {
			...this.document,
			natures: [...this.document.natures],
			groups: [...this.document.groups],
			nodes: [...this.document.nodes],
			junctions: [...this.document.junctions],
			relations: [...this.document.relations],
		};
	}
}
