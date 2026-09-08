import type { LogicDocument } from '../../../../lib/core/document/logic-document';
import type { LayoutPerformanceInsertion } from './scenario-types';

export function applyLayoutPerformanceInsertion(
	document: LogicDocument,
	insertion: LayoutPerformanceInsertion,
): LogicDocument {
	const removedRelationIds = new Set(insertion.removedRelationIds);
	return {
		...document,
		groups: [...document.groups, ...insertion.groups],
		nodes: [...document.nodes, insertion.node],
		junctions: [...document.junctions, ...insertion.junctions],
		relations: [
			...document.relations.filter(({ id }) => !removedRelationIds.has(id)),
			...insertion.addedRelations,
		],
	};
}
