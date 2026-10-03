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
	/** One relation into the junction from each distinct origin of the replaced relations. */
	readonly incoming: readonly LogicRelation[];
	/** One relation from the junction to each distinct destination of the replaced relations. */
	readonly outgoing: readonly LogicRelation[];
	/** The relations the junction replaces; removed last so no junction ever stands unanchored. */
	readonly replacedRelationIds: readonly string[];
}

interface JunctionInsertionOptions {
	readonly junctionId: string;
	readonly relationId: () => string;
	readonly operator: JunctionOperator;
}

/**
 * The relations converge on one junction, which points to every one of their destinations, in the
 * order the relations are given. Returns `undefined` without relations, or when a relation or an
 * endpoint is gone; the caller keeps aggregates out of reach.
 */
export function planJunctionInsertion(
	document: LogicDocument,
	relationIds: readonly string[],
	options: JunctionInsertionOptions,
): JunctionInsertionPlan | undefined {
	const endpointIds = new Set(
		[...document.nodes, ...document.groups, ...document.junctions].map(({ id }) => id),
	);
	const replaced: LogicRelation[] = [];
	for (const relationId of new Set(relationIds)) {
		const relation = document.relations.find(({ id }) => id === relationId);
		if (relation === undefined) return undefined;
		if (!endpointIds.has(relation.from) || !endpointIds.has(relation.to)) return undefined;
		replaced.push(relation);
	}
	if (replaced.length === 0) return undefined;
	const junctionId = options.junctionId;
	return {
		junction: { id: junctionId, operator: options.operator },
		incoming: [...new Set(replaced.map(({ from }) => from))].map((from) => ({
			id: options.relationId(),
			from,
			to: junctionId,
		})),
		outgoing: [...new Set(replaced.map(({ to }) => to))].map((to) => ({
			id: options.relationId(),
			from: junctionId,
			to,
		})),
		replacedRelationIds: replaced.map(({ id }) => id),
	};
}
