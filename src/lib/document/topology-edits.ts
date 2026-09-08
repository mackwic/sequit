import { createGraph, type GraphDiagnostic } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import { orderEndpoints } from '../layout/endpoint-order';
import type { OrderKeySpace } from '../layout/order-key-space';
import { defined } from './logic-document';
import {
	EndpointKind,
	type LogicDocument,
	type LogicNode,
	type LogicRelation,
	type NewLogicNode,
	type OrderKey,
	type SequitDiagnostic,
} from './logic-document';
import {
	projectEligibleRelationAddition,
	TopologyEditDiagnosticCode,
} from './topology-edit-ordering';
import { validateLogicDocument } from './validate-logic-document';

interface TopologyEditDiagnostic {
	readonly code: TopologyEditDiagnosticCode | GraphDiagnostic['code'] | SequitDiagnostic['code'];
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
	readonly expectedOrder?: readonly string[];
	readonly materializedOrder?: readonly string[];
	readonly expectedScore?: number;
	readonly materializedScore?: number;
}

interface RelationAdditionProjection {
	readonly document: LogicDocument;
	readonly eligible: boolean;
	readonly moved: boolean;
	readonly previousScore?: number;
	readonly selectedScore?: number;
	readonly changes: DocumentChangeSet;
}

interface NodeAdditionProjection {
	readonly document: LogicDocument;
	readonly changes: DocumentChangeSet;
}

interface EndpointOrderChange {
	readonly endpointKind: EndpointKind;
	readonly endpointId: string;
	readonly layoutOrder: OrderKey;
}

interface NodeMarkdownReplacement {
	readonly nodeId: string;
	readonly markdown: string;
}

export interface DocumentChangeSet {
	readonly nodeAdditions: readonly LogicNode[];
	readonly relationAdditions: readonly LogicRelation[];
	readonly endpointOrderChanges: readonly EndpointOrderChange[];
	readonly nodeMarkdownReplacements: readonly NodeMarkdownReplacement[];
}

interface NodeAdditionSuccess {
	readonly ok: true;
	readonly value: NodeAdditionProjection;
}

interface NodeAdditionFailure {
	readonly ok: false;
	readonly diagnostics: readonly TopologyEditDiagnostic[];
}

export type NodeAdditionResult = NodeAdditionSuccess | NodeAdditionFailure;

interface RelationAdditionSuccess {
	readonly ok: true;
	readonly value: RelationAdditionProjection;
}

interface RelationAdditionFailure {
	readonly ok: false;
	readonly diagnostics: readonly TopologyEditDiagnostic[];
}

export type RelationAdditionResult = RelationAdditionSuccess | RelationAdditionFailure;

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

function nodeMaterializationFailure(
	path: readonly string[],
	expectedOrder: readonly string[],
	materializedOrder: readonly string[],
): NodeAdditionFailure {
	return {
		ok: false,
		diagnostics: [
			{
				code: TopologyEditDiagnosticCode.EndpointOrderMaterializationFailed,
				message: `Allocated order key did not materialize the selected endpoint order at ${path.join('.')}`,
				path,
				expectedOrder,
				materializedOrder,
			},
		],
	};
}

function isImmediatelyBeforeTargetLayer(
	sourceRank: number,
	targetRank: number,
	targetIsJunction: boolean,
): boolean {
	if (targetIsJunction) return sourceRank === targetRank;
	return sourceRank === targetRank - 1;
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
	let lastKey: OrderKey | undefined;
	if (lastId !== undefined) lastKey = defined(endpointsById.get(lastId)).layoutOrder;
	const slot: { before?: OrderKey } = {};
	if (lastKey !== undefined) slot.before = lastKey;
	const keyedNode: LogicNode = {
		...node,
		kind: EndpointKind.Node,
		layoutOrder: orderKeySpace.keyFor(slot, node.id),
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
		return nodeMaterializationFailure(
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
				nodeMarkdownReplacements: [],
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
					code: TopologyEditDiagnosticCode.DuplicateRelationId,
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
	const sourceRank = ranks.byEndpointId.get(relation.from);
	const targetRank = ranks.byEndpointId.get(relation.to);
	const targetIsJunction = graph.endpointsById.get(relation.to)?.kind === EndpointKind.Junction;
	// TODO: Move group targets as atomic ordered blocks once block ordering is defined.
	const targetIsNotGroup = graph.endpointsById.get(relation.to)?.kind !== EndpointKind.Group;
	const ranksExist = sourceRank !== undefined && targetRank !== undefined;
	const ranksAreAdjacent =
		ranksExist && isImmediatelyBeforeTargetLayer(sourceRank, targetRank, targetIsJunction);
	const eligible = targetIsNotGroup && ranksAreAdjacent;
	if (!eligible) {
		return {
			ok: true,
			value: {
				document: validatedDocument,
				eligible: false,
				moved: false,
				changes: {
					nodeAdditions: [],
					relationAdditions: [relation],
					endpointOrderChanges: [],
					nodeMarkdownReplacements: [],
				},
			},
		};
	}
	return projectEligibleRelationAddition({
		document: validatedDocument,
		relation,
		graph,
		ranks,
		orderKeySpace,
		targetRank,
		targetIsJunction,
	});
}
