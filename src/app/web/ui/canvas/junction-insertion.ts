import type {
	JunctionOperator,
	LogicDocument,
	LogicRelation,
} from '../../../../lib/core/document/logic-document';

/** Only a plain relation hosts a junction: an aggregate stands for several source relations. */
export function hostsJunction(relation: {
	readonly canChangeFrom?: boolean;
	readonly canChangeTo?: boolean;
}): boolean {
	return relation.canChangeFrom === true && relation.canChangeTo === true;
}

/** The junction to create and the relations that thread it between the former endpoints. */
export interface JunctionInsertionPlan {
	readonly junction: { readonly id: string; readonly operator: JunctionOperator };
	readonly incoming: LogicRelation;
	readonly outgoing: LogicRelation;
	/** The relation the junction replaces; removed last so no junction ever stands unanchored. */
	readonly replacedRelationId: string;
}

interface JunctionInsertionOptions {
	readonly junctionId: string;
	readonly relationId: () => string;
	readonly operator: JunctionOperator;
}

/** Returns `undefined` when the relation or an endpoint is gone; the caller keeps aggregates out of reach. */
export function planJunctionInsertion(
	document: LogicDocument,
	relationId: string,
	options: JunctionInsertionOptions,
): JunctionInsertionPlan | undefined {
	const relation = document.relations.find(({ id }) => id === relationId);
	if (relation === undefined) return undefined;
	const endpointIds = new Set(
		[...document.nodes, ...document.groups, ...document.junctions].map(({ id }) => id),
	);
	if (!endpointIds.has(relation.from) || !endpointIds.has(relation.to)) return undefined;
	return {
		junction: { id: options.junctionId, operator: options.operator },
		incoming: { id: options.relationId(), from: relation.from, to: options.junctionId },
		outgoing: { id: options.relationId(), from: options.junctionId, to: relation.to },
		replacedRelationId: relation.id,
	};
}
