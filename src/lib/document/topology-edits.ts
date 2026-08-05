import { createGraph, type GraphDiagnostic } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import { selectTargetInsertionSlot } from '../layout/crossing-aware-order';
import { orderEndpoints } from '../layout/endpoint-order';
import { fractionalOrderKeySpace } from '../layout/order-key-space';
import type { LogicDocument, LogicEndpoint, LogicRelation, OrderKey } from './logic-document';

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

export interface EndpointOrderChange {
	readonly endpointId: string;
	readonly layoutOrder: OrderKey;
}

export interface DocumentChangeSet {
	readonly relationAdditions: readonly LogicRelation[];
	readonly endpointOrderChanges: readonly EndpointOrderChange[];
}

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
	return {
		...document,
		groups: document.groups.map((endpoint) =>
			endpoint.id === replacement.id ? (replacement as typeof endpoint) : endpoint,
		),
		nodes: document.nodes.map((endpoint) =>
			endpoint.id === replacement.id ? (replacement as typeof endpoint) : endpoint,
		),
		junctions: document.junctions.map((endpoint) =>
			endpoint.id === replacement.id ? (replacement as typeof endpoint) : endpoint,
		),
	};
}

export function projectRelationAddition(
	document: LogicDocument,
	relation: LogicRelation,
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
	const endpointOrder = orderEndpoints(endpoints);
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
				changes: { relationAdditions: [relation], endpointOrderChanges: [] },
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
		const targetIndex = selection.order.indexOf(relation.to);
		const keys = new Map<string, OrderKey>();
		let previous: OrderKey | undefined;
		for (const id of row) {
			const explicit = endpoints.find((endpoint) => endpoint.id === id)?.layoutOrder;
			const key =
				explicit !== undefined && fractionalOrderKeySpace.isValid(explicit)
					? explicit
					: fractionalOrderKeySpace.keyFor({ before: previous });
			keys.set(id, key);
			previous = key;
		}
		const beforeId = selection.order[targetIndex - 1];
		const afterId = selection.order[targetIndex + 1];
		const before = keys.get(beforeId);
		const after = keys.get(afterId);
		const target = endpoints.find(({ id }) => id === relation.to);
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
					changes: { relationAdditions: [relation], endpointOrderChanges: [] },
				},
			};
		}
		const layoutOrder = fractionalOrderKeySpace.keyFor({ before, after }, target.id);
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
			changes: { relationAdditions: [relation], endpointOrderChanges: orderChanges },
		},
	};
}
