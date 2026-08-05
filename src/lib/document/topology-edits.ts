import { createGraph, type GraphDiagnostic } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import { selectTargetInsertionSlot } from '../layout/crossing-aware-order';
import { orderEndpoints } from '../layout/endpoint-order';
import type { OrderKeySpace } from '../layout/order-key-space';
import {
	EndpointKind,
	type LogicDocument,
	type LogicEndpoint,
	type LogicNode,
	type LogicRelation,
	type NewLogicNode,
	type OrderKey,
	type SequitDiagnostic,
} from './logic-document';
import { validateLogicDocument } from './validate-logic-document';

export interface TopologyEditDiagnostic {
	readonly code: 'duplicate-relation-id' | GraphDiagnostic['code'];
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
}

export interface RelationAdditionProjection {
	readonly document: LogicDocument;
	readonly eligible: boolean;
	readonly moved: boolean;
	readonly previousScore?: number;
	readonly selectedScore?: number;
	readonly changes: DocumentChangeSet;
}

export interface NodeAdditionProjection {
	readonly document: LogicDocument;
	readonly changes: DocumentChangeSet;
}

export interface EndpointOrderChange {
	readonly endpointId: string;
	readonly layoutOrder: OrderKey;
}

export interface DocumentChangeSet {
	readonly nodeAdditions: readonly LogicNode[];
	readonly relationAdditions: readonly LogicRelation[];
	readonly endpointOrderChanges: readonly EndpointOrderChange[];
}

export type NodeAdditionResult =
	| { readonly ok: true; readonly value: NodeAdditionProjection }
	| { readonly ok: false; readonly diagnostics: readonly SequitDiagnostic[] };

export interface RelationAdditionSuccess {
	readonly ok: true;
	readonly value: RelationAdditionProjection;
}

export interface RelationAdditionFailure {
	readonly ok: false;
	readonly diagnostics: readonly TopologyEditDiagnostic[];
}

export type RelationAdditionResult = RelationAdditionSuccess | RelationAdditionFailure;

function weakComponentContaining(
	targetId: string,
	outgoing: ReadonlyMap<string, readonly string[]>,
	predecessors: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
	const component = new Set<string>();
	const pending = [targetId];
	while (pending.length > 0) {
		const id = pending.pop();
		if (id === undefined || component.has(id)) continue;
		component.add(id);
		for (const adjacent of [...(outgoing.get(id) ?? []), ...(predecessors.get(id) ?? [])]) {
			if (!component.has(adjacent)) pending.push(adjacent);
		}
	}
	return component;
}

function replaceEndpoint(document: LogicDocument, replacement: LogicEndpoint): LogicDocument {
	switch (replacement.kind) {
		case EndpointKind.Group:
			return {
				...document,
				groups: document.groups.map((endpoint) =>
					endpoint.id === replacement.id ? replacement : endpoint,
				),
			};
		case EndpointKind.Node:
			return {
				...document,
				nodes: document.nodes.map((endpoint) =>
					endpoint.id === replacement.id ? replacement : endpoint,
				),
			};
		case EndpointKind.Junction:
			return {
				...document,
				junctions: document.junctions.map((endpoint) =>
					endpoint.id === replacement.id ? replacement : endpoint,
				),
			};
	}
}

export function projectNodeAddition(
	document: LogicDocument,
	node: NewLogicNode,
	orderKeySpace: OrderKeySpace,
): NodeAdditionResult {
	const endpoints = [...document.groups, ...document.nodes, ...document.junctions];
	const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
	const orderedIds = orderEndpoints(endpoints, orderKeySpace);
	const lastId = orderedIds.at(-1);
	const lastKey = lastId === undefined ? undefined : endpointsById.get(lastId)?.layoutOrder;
	if (lastId !== undefined && lastKey === undefined) {
		throw new Error(`Missing ordered endpoint: ${lastId}`);
	}
	const keyedNode: LogicNode = {
		...node,
		kind: EndpointKind.Node,
		layoutOrder: orderKeySpace.keyFor({ before: lastKey }, node.id),
	};
	const tentative: LogicDocument = {
		...document,
		nodes: [...document.nodes, keyedNode],
	};
	const validated = validateLogicDocument(tentative);
	if (!validated.ok) return validated;
	return {
		ok: true,
		value: {
			document: validated.value,
			changes: {
				nodeAdditions: [keyedNode],
				relationAdditions: [],
				endpointOrderChanges: [],
			},
		},
	};
}

export function projectRelationAddition(
	document: LogicDocument,
	relation: LogicRelation,
	orderKeySpace: OrderKeySpace,
): RelationAdditionResult {
	if (document.relations.some(({ id }) => id === relation.id)) {
		return {
			ok: false,
			diagnostics: [
				{
					code: 'duplicate-relation-id',
					message: `Relation id already exists: ${relation.id}`,
					path: ['relations', relation.id],
				},
			],
		};
	}

	const tentativeDocument: LogicDocument = {
		...document,
		relations: [...document.relations, relation],
	};
	const tentativeGraph = createGraph(tentativeDocument);
	if (!tentativeGraph.ok) return tentativeGraph;
	const graph = tentativeGraph.value;
	const ranks = topologicallyRank(graph);
	const endpoints: readonly LogicEndpoint[] = [
		...document.groups,
		...document.nodes,
		...document.junctions,
	];
	const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
	const endpointOrder = orderEndpoints(endpoints, orderKeySpace);
	const sourceRank = ranks.byEndpointId.get(relation.from);
	const targetRank = ranks.byEndpointId.get(relation.to);
	const eligible =
		sourceRank !== undefined && targetRank !== undefined && sourceRank === targetRank - 1;
	if (!eligible) {
		return {
			ok: true,
			value: {
				document: tentativeDocument,
				eligible: false,
				moved: false,
				changes: { nodeAdditions: [], relationAdditions: [relation], endpointOrderChanges: [] },
			},
		};
	}

	const junctionIds = new Set(document.junctions.map(({ id }) => id));
	const targetIsJunction = junctionIds.has(relation.to);
	const component = weakComponentContaining(
		relation.to,
		graph.outgoingByEndpointId,
		graph.predecessorsByEndpointId,
	);
	const row = endpointOrder.filter(
		(id) =>
			component.has(id) &&
			ranks.byEndpointId.get(id) === targetRank &&
			junctionIds.has(id) === targetIsJunction,
	);
	const selection = selectTargetInsertionSlot(row, relation.to, {
		effectiveLinks: graph.effectiveLinks,
		effectiveEndpointOrder: endpointOrder,
		ranks: ranks.byEndpointId,
		junctionIds,
	});
	let selectedDocument = tentativeDocument;
	let orderChanges: EndpointOrderChange[] = [];
	if (selection.moved) {
		const targetIndex = selection.bestSlot;
		const keys = new Map<string, OrderKey>();
		for (const id of row) {
			const endpoint = endpointsById.get(id);
			if (!endpoint) throw new Error(`Missing ordered endpoint: ${id}`);
			const key = endpoint.layoutOrder;
			keys.set(id, key);
		}
		const beforeId = selection.order[targetIndex - 1];
		const afterId = selection.order[targetIndex + 1];
		const before = keys.get(beforeId);
		const after = keys.get(afterId);
		const target = endpointsById.get(relation.to);
		if (!target) throw new Error(`Missing relation target: ${relation.to}`);
		if (before !== undefined && after !== undefined && before === after) {
			// A scalar key cannot represent a position inside an externally-created
			// duplicate-key cluster without rewriting a peer. Preserve locality and
			// leave the established row untouched; newly allocated keys are
			// discriminated so normal concurrent additions do not create this state.
			return {
				ok: true,
				value: {
					document: tentativeDocument,
					eligible: true,
					moved: false,
					previousScore: selection.currentScore,
					selectedScore: selection.currentScore,
					changes: {
						nodeAdditions: [],
						relationAdditions: [relation],
						endpointOrderChanges: [],
					},
				},
			};
		}
		const layoutOrder = orderKeySpace.keyFor({ before, after }, target.id);
		orderChanges = [{ endpointId: target.id, layoutOrder }];
		selectedDocument = replaceEndpoint(tentativeDocument, { ...target, layoutOrder });
	}
	return {
		ok: true,
		value: {
			document: selectedDocument,
			eligible: true,
			moved: selection.moved,
			previousScore: selection.currentScore,
			selectedScore: selection.bestScore,
			changes: {
				nodeAdditions: [],
				relationAdditions: [relation],
				endpointOrderChanges: orderChanges,
			},
		},
	};
}
