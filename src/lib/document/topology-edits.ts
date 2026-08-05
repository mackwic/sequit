import { createGraph, type GraphDiagnostic } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import {
	crossingScoreTolerance,
	scoreTargetInsertionSlots,
	selectTargetInsertionSlot,
} from '../layout/crossing-aware-order';
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
	readonly code:
		| 'duplicate-relation-id'
		| 'endpoint-order-materialization-failed'
		| GraphDiagnostic['code']
		| SequitDiagnostic['code'];
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
	readonly expectedOrder?: readonly string[];
	readonly materializedOrder?: readonly string[];
	readonly expectedScore?: number;
	readonly materializedScore?: number;
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
	readonly endpointKind: EndpointKind;
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
	| { readonly ok: false; readonly diagnostics: readonly TopologyEditDiagnostic[] };

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

function replaceExactlyOne<T extends LogicEndpoint>(
	endpoints: readonly T[],
	replacement: T,
): readonly T[] {
	let replacements = 0;
	const result = endpoints.map((endpoint) => {
		if (endpoint.id !== replacement.id) return endpoint;
		replacements += 1;
		return replacement;
	});
	if (replacements !== 1) {
		throw new Error(`Expected exactly one endpoint replacement for: ${replacement.id}`);
	}
	return result;
}

function replaceEndpoint(document: LogicDocument, replacement: LogicEndpoint): LogicDocument {
	switch (replacement.kind) {
		case EndpointKind.Group:
			return {
				...document,
				groups: replaceExactlyOne(document.groups, replacement),
			};
		case EndpointKind.Node:
			return {
				...document,
				nodes: replaceExactlyOne(document.nodes, replacement),
			};
		case EndpointKind.Junction:
			return {
				...document,
				junctions: replaceExactlyOne(document.junctions, replacement),
			};
	}
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

function visualRow(
	endpointOrder: readonly string[],
	component: ReadonlySet<string>,
	ranks: ReadonlyMap<string, number>,
	targetRank: number,
	junctionIds: ReadonlySet<string>,
	targetIsJunction: boolean,
): readonly string[] {
	return endpointOrder.filter(
		(id) =>
			component.has(id) && ranks.get(id) === targetRank && junctionIds.has(id) === targetIsJunction,
	);
}

function materializationFailure(
	path: readonly string[],
	expectedOrder: readonly string[],
	materializedOrder: readonly string[],
	expectedScore?: number,
	materializedScore?: number,
): { readonly ok: false; readonly diagnostics: readonly TopologyEditDiagnostic[] } {
	return {
		ok: false,
		diagnostics: [
			{
				code: 'endpoint-order-materialization-failed',
				message: `Allocated order key did not materialize the selected endpoint order at ${path.join('.')}`,
				path,
				expectedOrder,
				materializedOrder,
				expectedScore,
				materializedScore,
			},
		],
	};
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
	const materializedOrder = orderEndpoints(
		[...validated.value.groups, ...validated.value.nodes, ...validated.value.junctions],
		orderKeySpace,
	);
	const expectedOrder = [...orderedIds, node.id];
	if (!sameOrder(materializedOrder, expectedOrder)) {
		return materializationFailure(
			['nodes', node.id, 'layoutOrder'],
			expectedOrder,
			materializedOrder,
		);
	}
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
	const validatedTentative = validateLogicDocument(tentativeDocument);
	if (!validatedTentative.ok) return validatedTentative;
	const tentativeGraph = createGraph(validatedTentative.value);
	if (!tentativeGraph.ok) return tentativeGraph;
	const graph = tentativeGraph.value;
	const ranks = topologicallyRank(graph);
	const validatedDocument = validatedTentative.value;
	const endpoints: readonly LogicEndpoint[] = [
		...validatedDocument.groups,
		...validatedDocument.nodes,
		...validatedDocument.junctions,
	];
	const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
	const endpointOrder = orderEndpoints(endpoints, orderKeySpace);
	const sourceRank = ranks.byEndpointId.get(relation.from);
	const targetRank = ranks.byEndpointId.get(relation.to);
	// TODO: Move group targets as atomic ordered blocks once block ordering is defined.
	const eligible =
		graph.endpointsById.get(relation.to)?.kind !== EndpointKind.Group &&
		sourceRank !== undefined &&
		targetRank !== undefined &&
		sourceRank === targetRank - 1;
	if (!eligible) {
		return {
			ok: true,
			value: {
				document: validatedDocument,
				eligible: false,
				moved: false,
				changes: { nodeAdditions: [], relationAdditions: [relation], endpointOrderChanges: [] },
			},
		};
	}

	const junctionIds = new Set(validatedDocument.junctions.map(({ id }) => id));
	const targetIsJunction = junctionIds.has(relation.to);
	const component = weakComponentContaining(
		relation.to,
		graph.outgoingByEndpointId,
		graph.predecessorsByEndpointId,
	);
	const row = visualRow(
		endpointOrder,
		component,
		ranks.byEndpointId,
		targetRank,
		junctionIds,
		targetIsJunction,
	);
	const selection = selectTargetInsertionSlot(row, relation.to, {
		effectiveRelations: graph.effectiveRelations,
		effectiveEndpointOrder: endpointOrder,
		ranks: ranks.byEndpointId,
		junctionIds,
	});
	let selectedDocument = validatedDocument;
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
					document: validatedDocument,
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
		selectedDocument = replaceEndpoint(validatedDocument, { ...target, layoutOrder });
		const materializedEndpointOrder = orderEndpoints(
			[...selectedDocument.groups, ...selectedDocument.nodes, ...selectedDocument.junctions],
			orderKeySpace,
		);
		const materializedRow = visualRow(
			materializedEndpointOrder,
			component,
			ranks.byEndpointId,
			targetRank,
			junctionIds,
			targetIsJunction,
		);
		if (!sameOrder(materializedRow, selection.order)) {
			return materializationFailure(
				['relations', relation.id, 'to'],
				selection.order,
				materializedRow,
				selection.bestScore,
			);
		}
		const materializedScores = scoreTargetInsertionSlots(materializedRow, relation.to, {
			effectiveRelations: graph.effectiveRelations,
			effectiveEndpointOrder: materializedEndpointOrder,
			ranks: ranks.byEndpointId,
			junctionIds,
		});
		const materializedScore =
			materializedScores.scoreBySlot[materializedScores.currentSlot] ?? Number.NaN;
		const scoreMatches =
			Math.abs(materializedScore - selection.bestScore) <=
			crossingScoreTolerance(materializedScore, selection.bestScore);
		const strictlyImproves =
			materializedScore <
			selection.currentScore - crossingScoreTolerance(materializedScore, selection.currentScore);
		if (!scoreMatches || !strictlyImproves) {
			return materializationFailure(
				['relations', relation.id, 'to'],
				selection.order,
				materializedRow,
				selection.bestScore,
				materializedScore,
			);
		}
		orderChanges = [{ endpointKind: target.kind, endpointId: target.id, layoutOrder }];
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
