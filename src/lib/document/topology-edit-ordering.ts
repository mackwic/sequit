import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import {
	crossingScoreTolerance,
	scoreTargetInsertionSlots,
	selectTargetInsertionSlot,
} from '../layout/crossing-aware-order';
import { orderEndpoints } from '../layout/endpoint-order';
import type { EndpointSlot, OrderKeySpace } from '../layout/order-key-space';
import { defined } from './logic-document';
import {
	EndpointKind,
	type LogicDocument,
	type LogicEndpoint,
	type LogicRelation,
	type OrderKey,
	type SequitDiagnostic,
} from './logic-document';

export enum TopologyEditDiagnosticCode {
	DuplicateRelationId = 'duplicate-relation-id',
	EndpointOrderMaterializationFailed = 'endpoint-order-materialization-failed',
}

interface EndpointOrderChange {
	readonly endpointKind: EndpointKind;
	readonly endpointId: string;
	readonly layoutOrder: OrderKey;
}

interface RelationAdditionProjection {
	readonly document: LogicDocument;
	readonly eligible: boolean;
	readonly moved: boolean;
	readonly previousScore?: number;
	readonly selectedScore?: number;
	readonly changes: {
		readonly nodeAdditions: readonly never[];
		readonly relationAdditions: readonly LogicRelation[];
		readonly endpointOrderChanges: readonly EndpointOrderChange[];
		readonly nodeMarkdownReplacements: readonly never[];
	};
}

interface TopologyEditDiagnostic {
	readonly code: TopologyEditDiagnosticCode | SequitDiagnostic['code'];
	readonly message: string;
	readonly path: readonly string[];
	readonly expectedOrder?: readonly string[];
	readonly materializedOrder?: readonly string[];
	readonly expectedScore?: number;
	readonly materializedScore?: number;
}

interface RelationAdditionSuccess {
	readonly ok: true;
	readonly value: RelationAdditionProjection;
}

interface RelationAdditionFailure {
	readonly ok: false;
	readonly diagnostics: readonly TopologyEditDiagnostic[];
}

type RelationAdditionResult = RelationAdditionSuccess | RelationAdditionFailure;

interface VisualRowOptions {
	readonly endpointOrder: readonly string[];
	readonly component: ReadonlySet<string>;
	readonly ranks: ReadonlyMap<string, number>;
	readonly targetRank: number;
	readonly junctionIds: ReadonlySet<string>;
	readonly targetIsJunction: boolean;
}

interface MaterializationFailureOptions {
	readonly path: readonly string[];
	readonly expectedOrder: readonly string[];
	readonly materializedOrder: readonly string[];
	readonly expectedScore?: number;
	readonly materializedScore?: number;
}

export interface EligibleRelationProjectionOptions {
	readonly document: LogicDocument;
	readonly relation: LogicRelation;
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly orderKeySpace: OrderKeySpace;
	readonly targetRank: number;
	readonly targetIsJunction: boolean;
}

interface SuccessfulProjectionOptions {
	readonly document: LogicDocument;
	readonly relation: LogicRelation;
	readonly previousScore: number;
	readonly selectedScore: number;
	readonly orderChanges: readonly EndpointOrderChange[];
}

function weakComponentContaining(
	targetId: string,
	outgoing: ReadonlyMap<string, readonly string[]>,
	predecessors: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
	const component = new Set<string>();
	const pending = [targetId];
	while (pending.length > 0) {
		const id = defined(pending.pop());
		if (component.has(id)) continue;
		component.add(id);
		for (const adjacent of [...defined(outgoing.get(id)), ...defined(predecessors.get(id))]) {
			if (!component.has(adjacent)) pending.push(adjacent);
		}
	}
	return component;
}

function replaceExactlyOne<T extends LogicEndpoint>(
	endpoints: readonly T[],
	replacement: T,
): readonly T[] {
	return endpoints.map((endpoint) => {
		if (endpoint.id !== replacement.id) return endpoint;
		return replacement;
	});
}

function replaceEndpoint(document: LogicDocument, replacement: LogicEndpoint): LogicDocument {
	switch (replacement.kind) {
		case EndpointKind.Group:
			return { ...document, groups: replaceExactlyOne(document.groups, replacement) };
		case EndpointKind.Node:
			return { ...document, nodes: replaceExactlyOne(document.nodes, replacement) };
		case EndpointKind.Junction:
			return { ...document, junctions: replaceExactlyOne(document.junctions, replacement) };
		default:
			throw new Error('Unsupported endpoint kind');
	}
}

function visualRow(options: VisualRowOptions): readonly string[] {
	return options.endpointOrder.filter((id) => {
		const inTargetRank = options.ranks.get(id) === options.targetRank;
		const hasTargetKind = options.junctionIds.has(id) === options.targetIsJunction;
		return options.component.has(id) && inTargetRank && hasTargetKind;
	});
}

function materializationFailure(options: MaterializationFailureOptions): RelationAdditionResult {
	const scores: { expectedScore?: number; materializedScore?: number } = {};
	if (options.expectedScore !== undefined) scores.expectedScore = options.expectedScore;
	if (options.materializedScore !== undefined) scores.materializedScore = options.materializedScore;
	const diagnostic: TopologyEditDiagnostic = {
		code: TopologyEditDiagnosticCode.EndpointOrderMaterializationFailed,
		message: `Allocated order key did not materialize the selected endpoint order at ${options.path.join('.')}`,
		path: options.path,
		expectedOrder: options.expectedOrder,
		materializedOrder: options.materializedOrder,
		...scores,
	};
	return { ok: false, diagnostics: [diagnostic] };
}

function endpointSlot(before: OrderKey | undefined, after: OrderKey | undefined): EndpointSlot {
	const slot: { before?: OrderKey; after?: OrderKey } = {};
	if (before !== undefined) slot.before = before;
	if (after !== undefined) slot.after = after;
	return slot;
}

function duplicateKeyResult(
	document: LogicDocument,
	relation: LogicRelation,
	currentScore: number,
): RelationAdditionResult {
	return {
		ok: true,
		value: {
			document,
			eligible: true,
			moved: false,
			previousScore: currentScore,
			selectedScore: currentScore,
			changes: {
				nodeAdditions: [],
				relationAdditions: [relation],
				endpointOrderChanges: [],
				nodeMarkdownReplacements: [],
			},
		},
	};
}

function isDuplicateBoundedKey(before: OrderKey | undefined, after: OrderKey | undefined): boolean {
	if (before === undefined || after === undefined) return false;
	return before === after;
}

export function projectEligibleRelationAddition(
	options: EligibleRelationProjectionOptions,
): RelationAdditionResult {
	const { document, relation, graph, ranks, orderKeySpace, targetRank, targetIsJunction } = options;
	const endpoints: readonly LogicEndpoint[] = [
		...document.groups,
		...document.nodes,
		...document.junctions,
	];
	const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
	const endpointOrder = orderEndpoints(endpoints, orderKeySpace);
	const junctionIds = new Set(document.junctions.map(({ id }) => id));
	const component = weakComponentContaining(
		relation.to,
		graph.outgoingByEndpointId,
		graph.predecessorsByEndpointId,
	);
	const rowOptions = {
		endpointOrder,
		component,
		ranks: ranks.byEndpointId,
		targetRank,
		junctionIds,
		targetIsJunction,
	};
	const row = visualRow(rowOptions);
	const scoringContext = {
		effectiveRelations: graph.effectiveRelations,
		effectiveEndpointOrder: endpointOrder,
		ranks: ranks.byEndpointId,
		junctionIds,
	};
	const selection = selectTargetInsertionSlot(row, relation.to, scoringContext);
	if (!selection.moved) {
		return successfulProjection({
			document,
			relation,
			previousScore: selection.currentScore,
			selectedScore: selection.bestScore,
			orderChanges: [],
		});
	}

	const keys = new Map<string, OrderKey>();
	for (const id of row) {
		const endpoint = defined(endpointsById.get(id));
		keys.set(id, endpoint.layoutOrder);
	}
	const beforeId = selection.order[selection.bestSlot - 1];
	const afterId = selection.order[selection.bestSlot + 1];
	let before: OrderKey | undefined;
	let after: OrderKey | undefined;
	if (beforeId !== undefined) before = keys.get(beforeId);
	if (afterId !== undefined) after = keys.get(afterId);
	const target = defined(endpointsById.get(relation.to));
	if (isDuplicateBoundedKey(before, after)) {
		return duplicateKeyResult(document, relation, selection.currentScore);
	}
	const layoutOrder = orderKeySpace.keyFor(endpointSlot(before, after), target.id);
	const selectedDocument = replaceEndpoint(document, { ...target, layoutOrder });
	const materializedEndpointOrder = orderEndpoints(
		[...selectedDocument.groups, ...selectedDocument.nodes, ...selectedDocument.junctions],
		orderKeySpace,
	);
	const materializedRow = visualRow({ ...rowOptions, endpointOrder: materializedEndpointOrder });
	if (!sameOrder(materializedRow, selection.order)) {
		return materializationFailure({
			path: ['relations', relation.id, 'to'],
			expectedOrder: selection.order,
			materializedOrder: materializedRow,
			expectedScore: selection.bestScore,
		});
	}
	const scores = scoreTargetInsertionSlots(materializedRow, relation.to, {
		...scoringContext,
		effectiveEndpointOrder: materializedEndpointOrder,
	});
	const materializedScore = defined(scores.scoreBySlot[scores.currentSlot]);
	const scoreMatches =
		Math.abs(materializedScore - selection.bestScore) <=
		crossingScoreTolerance(materializedScore, selection.bestScore);
	const improves =
		materializedScore <
		selection.currentScore - crossingScoreTolerance(materializedScore, selection.currentScore);
	if (!scoreMatches || !improves) {
		return materializationFailure({
			path: ['relations', relation.id, 'to'],
			expectedOrder: selection.order,
			materializedOrder: materializedRow,
			expectedScore: selection.bestScore,
			materializedScore,
		});
	}
	return successfulProjection({
		document: selectedDocument,
		relation,
		previousScore: selection.currentScore,
		selectedScore: selection.bestScore,
		orderChanges: [{ endpointKind: target.kind, endpointId: target.id, layoutOrder }],
	});
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

function successfulProjection(options: SuccessfulProjectionOptions): RelationAdditionResult {
	return {
		ok: true,
		value: {
			document: options.document,
			eligible: true,
			moved: options.orderChanges.length > 0,
			previousScore: options.previousScore,
			selectedScore: options.selectedScore,
			changes: {
				nodeAdditions: [],
				relationAdditions: [options.relation],
				endpointOrderChanges: options.orderChanges,
				nodeMarkdownReplacements: [],
			},
		},
	};
}
