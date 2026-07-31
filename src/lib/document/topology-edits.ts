import { createGraph, type GraphDiagnostic } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import { selectTargetInsertionSlot } from '../layout/crossing-aware-order';
import { deriveEffectiveEndpointOrder } from '../layout/endpoint-order';
import type { LogicDocument, LogicRelation } from './logic-document';

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
}

export type RelationAdditionResult =
	| { readonly ok: true; readonly value: RelationAdditionProjection }
	| { readonly ok: false; readonly diagnostics: readonly TopologyEditDiagnostic[] };

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

function reorderVisualRow(
	effectiveOrder: readonly string[],
	currentRow: readonly string[],
	selectedRow: readonly string[],
): readonly string[] {
	const rowIds = new Set(currentRow);
	let selectedIndex = 0;
	return effectiveOrder.map((id) => {
		if (!rowIds.has(id)) return id;
		const selected = selectedRow[selectedIndex];
		selectedIndex += 1;
		return selected;
	});
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
	const endpointOrder = deriveEffectiveEndpointOrder(document.endpointOrder, [
		...graph.endpointsById.keys(),
	]);
	const sourceRank = ranks.byEndpointId.get(relation.from);
	const targetRank = ranks.byEndpointId.get(relation.to);
	const eligible =
		sourceRank !== undefined && targetRank !== undefined && sourceRank === targetRank - 1;
	if (!eligible) {
		return {
			ok: true,
			value: {
				document: { ...tentativeDocument, endpointOrder },
				eligible: false,
				moved: false,
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
	const selectedEndpointOrder = selection.moved
		? reorderVisualRow(endpointOrder, row, selection.order)
		: endpointOrder;
	return {
		ok: true,
		value: {
			document: { ...tentativeDocument, endpointOrder: selectedEndpointOrder },
			eligible: true,
			moved: selection.moved,
			previousScore: selection.currentScore,
			selectedScore: selection.bestScore,
		},
	};
}
