import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNode,
	type LogicRelation,
	PERSISTENCE_FORMAT,
} from '../../../../lib/core/document/logic-document';
import { orderKey } from '../../../../lib/core/document/order-key';
import type { LayoutPerformanceScenarioName } from './scenario-name';
import type { LayoutPerformanceInsertion, LayoutPerformanceSnapshot } from './scenario-types';

const ID_WIDTH = 16;

function initialDocument(name: LayoutPerformanceScenarioName): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
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
	private readonly groups: LogicGroup[] = [];
	private readonly nodes: LogicNode[] = [];
	private readonly junctions: LogicJunction[] = [];
	private readonly relations: LogicRelation[] = [];
	private readonly existingIds = new Set<string>();
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
			kind: EndpointKind.Node,
			layoutOrder: orderKey(`a${index.toString().padStart(ID_WIDTH, '0')}1`),
			id: this.nodeId(index),
			natureId: 'performance-node',
			markdown: `Node ${index}`,
		};
		if (groupId === undefined) return node;
		return { ...node, groupId };
	}

	protected group(index: number, parentGroupId?: string): LogicGroup {
		const group: LogicGroup = {
			kind: EndpointKind.Group,
			layoutOrder: orderKey(`b${index.toString().padStart(ID_WIDTH, '0')}1`),
			id: this.groupId(index),
			label: `Group ${index}`,
		};
		if (parentGroupId === undefined) return group;
		return { ...group, groupId: parentGroupId };
	}

	protected junction(index: number): LogicJunction {
		return {
			kind: EndpointKind.Junction,
			id: this.junctionId(index),
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(`c${index.toString().padStart(ID_WIDTH, '0')}1`),
		};
	}

	/** Parent-first construction; retain the historical stable relation identifiers. */
	protected childToParent(parent: string, child: string): LogicRelation {
		return { id: this.relationId(parent, child), from: child, to: parent };
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
		const initial = initialDocument(this.name);
		this.groups.length = 0;
		this.nodes.length = 0;
		this.junctions.length = 0;
		this.relations.length = 0;
		this.existingIds.clear();
		this.document = {
			...initial,
			groups: this.groups,
			nodes: this.nodes,
			junctions: this.junctions,
			relations: this.relations,
		};
		this.ranks.length = 0;
		this.resetTopology();
	}

	private insertNextNode(): LayoutPerformanceInsertion {
		const nodeIndex = this.nodes.length;
		const insertion = this.insertNode(nodeIndex);
		if (insertion.name !== this.name || insertion.nodeIndex !== nodeIndex) {
			throw new Error(`Invalid insertion identity for ${this.name} at node ${nodeIndex}`);
		}
		if (insertion.node.id !== this.nodeId(nodeIndex)) {
			throw new Error(`Insertion must add stable node id ${this.nodeId(nodeIndex)}`);
		}

		const addedIds = new Set<string>();
		for (const entity of [
			insertion.node,
			...insertion.groups,
			...insertion.junctions,
			...insertion.addedRelations,
		]) {
			if (this.existingIds.has(entity.id) || addedIds.has(entity.id))
				throw new Error(`Duplicate insertion id: ${entity.id}`);
			addedIds.add(entity.id);
		}

		if (insertion.removedRelationIds.length > 0) {
			const removedRelationIds = new Set(insertion.removedRelationIds);
			let retained = 0;
			for (const relation of this.relations) {
				if (removedRelationIds.has(relation.id)) {
					this.existingIds.delete(relation.id);
					continue;
				}
				this.relations[retained] = relation;
				retained += 1;
			}
			this.relations.length = retained;
		}

		this.groups.push(...insertion.groups);
		this.nodes.push(insertion.node);
		this.junctions.push(...insertion.junctions);
		this.relations.push(...insertion.addedRelations);
		for (const id of addedIds) this.existingIds.add(id);
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
