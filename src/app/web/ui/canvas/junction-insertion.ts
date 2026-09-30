import type {
	JunctionOperator,
	LogicDocument,
	LogicEndpoint,
	LogicRelation,
} from '../../../../lib/core/document/logic-document';

/** Only a plain relation hosts a junction: an aggregate stands for several source relations. */
export function hostsJunction(relation: {
	readonly canChangeFrom?: boolean;
	readonly canChangeTo?: boolean;
}): boolean {
	return relation.canChangeFrom === true && relation.canChangeTo === true;
}

/** Where the junction lives: the endpoints' common group, else their shared lane and region. */
interface JunctionPlacement {
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

/** The junction to create and the relations that thread it between the former endpoints. */
export interface JunctionInsertionPlan {
	readonly junction: JunctionPlacement & {
		readonly id: string;
		readonly operator: JunctionOperator;
	};
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

function endpoint(document: LogicDocument, id: string): LogicEndpoint | undefined {
	return (
		document.nodes.find((candidate) => candidate.id === id) ??
		document.groups.find((candidate) => candidate.id === id) ??
		document.junctions.find((candidate) => candidate.id === id)
	);
}

function containerChain(document: LogicDocument, groupId: string | undefined): readonly string[] {
	const chain: string[] = [];
	let current = groupId;
	while (current !== undefined && !chain.includes(current)) {
		chain.push(current);
		current = document.groups.find(({ id }) => id === current)?.groupId;
	}
	return chain;
}

/** The deepest group holding both endpoints; a junction never leaves the graph it joins. */
function commonContainer(
	document: LogicDocument,
	from: LogicEndpoint,
	to: LogicEndpoint,
): string | undefined {
	const ancestors = new Set(containerChain(document, to.groupId));
	return containerChain(document, from.groupId).find((id) => ancestors.has(id));
}

function placement(
	document: LogicDocument,
	from: LogicEndpoint,
	to: LogicEndpoint,
): JunctionPlacement {
	const groupId = commonContainer(document, from, to);
	if (groupId !== undefined) return { groupId };
	const fields: { laneId?: string; regionId?: string } = {};
	if (from.laneId !== undefined && from.laneId === to.laneId) fields.laneId = from.laneId;
	if (from.regionId !== undefined && from.regionId === to.regionId) fields.regionId = from.regionId;
	return fields;
}

/** Returns `undefined` when the relation is gone; the caller keeps aggregates out of reach. */
export function planJunctionInsertion(
	document: LogicDocument,
	relationId: string,
	options: JunctionInsertionOptions,
): JunctionInsertionPlan | undefined {
	const relation = document.relations.find(({ id }) => id === relationId);
	if (relation === undefined) return undefined;
	const from = endpoint(document, relation.from);
	const to = endpoint(document, relation.to);
	if (from === undefined || to === undefined) return undefined;
	return {
		junction: {
			id: options.junctionId,
			operator: options.operator,
			...placement(document, from, to),
		},
		incoming: { id: options.relationId(), from: relation.from, to: options.junctionId },
		outgoing: { id: options.relationId(), from: options.junctionId, to: relation.to },
		replacedRelationId: relation.id,
	};
}
