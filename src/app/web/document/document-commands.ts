import { junctionPlacement } from '../../../lib/core/document/junction-placement';
import {
	EndpointKind,
	GroupState,
	type JunctionOperator,
	type LayoutConfiguration,
	type LogicDocument,
	type LogicGroup,
	type LogicRelation,
	type NewLogicNode,
} from '../../../lib/core/document/logic-document';
import { projectDeletion } from '../../../lib/core/document/topology-deletions';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	SharedProperty,
	type SharedRootLanes,
} from '../../../lib/infrastructure/document/shared-document-command';

/**
 * What an author edits in the group dialog; `''` for colour means the default, for the lane a
 * nested group (inherits) or a document without lanes.
 */
export interface GroupFields {
	readonly label: string;
	readonly color: string;
	readonly laneId: string;
}

export function groupFields(group: LogicGroup): GroupFields {
	return { label: group.label, color: group.color ?? '', laneId: group.laneId ?? '' };
}

/** Turns canvas intentions into the shared command vocabulary; every batch stays atomic. */

export function nodeCreation(node: NewLogicNode): SharedDocumentCommand {
	const { id, ...properties } = node;
	return { op: SharedCommandKind.Create, target: { kind: SharedElementKind.Node, id }, properties };
}

export function relationCreation({ id, from, to }: LogicRelation): SharedDocumentCommand {
	return {
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Relation, id },
		properties: { from, to },
	};
}

/** A node with its relations in one batch; the executor resolves the references at the end. */
export function connectedNodeCreation(
	node: NewLogicNode,
	relations: readonly LogicRelation[],
): readonly SharedDocumentCommand[] {
	return [nodeCreation(node), ...relations.map(relationCreation)];
}

/**
 * Threads a junction through relations: creations first, so no junction is ever unanchored. The
 * junction is created where its targets, the destinations, put it.
 */
export interface JunctionInsertion {
	readonly junction: { readonly id: string; readonly operator: JunctionOperator };
	readonly incoming: readonly LogicRelation[];
	readonly outgoing: readonly LogicRelation[];
	readonly replacedRelationIds: readonly string[];
}

export function junctionInsertion(
	document: LogicDocument,
	plan: JunctionInsertion,
): readonly SharedDocumentCommand[] {
	const { id, operator } = plan.junction;
	const targets = plan.outgoing.map(({ to }) => to);
	const properties = { operator, ...junctionPlacement(document, targets) };
	return [
		{ op: SharedCommandKind.Create, target: { kind: SharedElementKind.Junction, id }, properties },
		...plan.incoming.map(relationCreation),
		...plan.outgoing.map(relationCreation),
		{ op: SharedCommandKind.DeleteRelations, ids: plan.replacedRelationIds },
	];
}

export function junctionOperatorUpdate(
	junctionId: string,
	operator: JunctionOperator,
): SharedDocumentCommand {
	return {
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Junction, id: junctionId },
		set: { operator },
		unset: [],
	};
}

/** The nature alone changes; a colour or icon of the box's own stays above the new nature's. */
export function nodeNatureUpdate(nodeId: string, natureId: string): SharedDocumentCommand {
	return {
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Node, id: nodeId },
		set: { natureId },
		unset: [],
	};
}

/** The executor derives the container from the members and refuses mixed containers. */
export function groupCreation(id: string, members: readonly string[]): SharedDocumentCommand {
	return { op: SharedCommandKind.Group, id, label: 'Groupe', members };
}

/** The label is a text: callers splice it through `updateText`; colour and lane travel here. */
export function groupStyleUpdate(
	groupId: string,
	before: GroupFields,
	after: GroupFields,
): SharedDocumentCommand | undefined {
	const set: { color?: string; laneId?: string } = {};
	const unset: SharedProperty.Color[] = [];
	if (before.color !== after.color) {
		if (after.color === '') unset.push(SharedProperty.Color);
		else set.color = after.color;
	}
	if (before.laneId !== after.laneId && after.laneId !== '') set.laneId = after.laneId;
	if (Object.keys(set).length === 0 && unset.length === 0) return undefined;
	const target = { kind: SharedElementKind.Group, id: groupId } as const;
	return { op: SharedCommandKind.Update, target, set, unset };
}

export function groupFoldToggle(group: LogicGroup): SharedDocumentCommand {
	let state = GroupState.Closed;
	if (group.state === GroupState.Closed) state = GroupState.Expanded;
	return {
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Group, id: group.id },
		set: { state },
		unset: [],
	};
}

/** Members stay in the parent container; the group and its own relations go. */
export function groupDissolution(groupId: string): SharedDocumentCommand {
	return { op: SharedCommandKind.Ungroup, id: groupId };
}

/** Drops the elements into a group, or onto the canvas root; the executor refuses cycles. */
export function containerMove(
	ids: readonly string[],
	groupId: string | undefined,
): SharedDocumentCommand {
	if (groupId === undefined) return { op: SharedCommandKind.Move, ids };
	return { op: SharedCommandKind.Move, ids, groupId };
}

/** Direction and bias always change together; the layout recomputes from the same document. */
export function layoutUpdate(layout: LayoutConfiguration): SharedDocumentCommand {
	return { op: SharedCommandKind.UpdateLayout, layout };
}

/** The whole root lane set in one refusable step; `undefined` returns to a single implicit lane. */
export function lanesUpdate(
	lanes: SharedRootLanes | undefined,
	transfers: Readonly<Record<string, string>> = {},
): SharedDocumentCommand {
	if (lanes === undefined) return { op: SharedCommandKind.UpdateLanes };
	return { op: SharedCommandKind.UpdateLanes, lanes, transfers };
}

/**
 * Deletes a selection with its group descendants and every incident relation. Relations go first
 * so no later removal finds a missing target; an emptied group is then dissolved.
 *
 * A removed junction's surviving sources are first related to its surviving targets, so its
 * deletion keeps the flow it carried; creations precede removals like a junction insertion.
 *
 * A junction exists only while anchored on both sides: the executor collects unanchored junctions
 * after every deletion, so removing a junction's relations removes the junction. An explicit
 * junction removal is emitted only when nothing else in the batch would trigger that collection,
 * and once is enough because the first collection removes every unanchored junction.
 */
export function deletion(
	document: LogicDocument,
	endpointIds: readonly string[],
	relationIds: readonly string[],
	relationId: () => string,
): readonly SharedDocumentCommand[] {
	const changes = projectDeletion(document, endpointIds, relationIds, relationId);
	const commands = changes.relationAdditions.map(relationCreation);
	const relations = changes.relationRemovals ?? [];
	if (relations.length > 0)
		commands.push({ op: SharedCommandKind.DeleteRelations, ids: relations });
	const endpoints = changes.endpointRemovals ?? [];
	for (const { endpointKind, endpointId } of endpoints) {
		if (endpointKind === EndpointKind.Group)
			commands.push({ op: SharedCommandKind.Ungroup, id: endpointId });
		if (endpointKind === EndpointKind.Node)
			commands.push({
				op: SharedCommandKind.Delete,
				target: { kind: SharedElementKind.Node, id: endpointId },
			});
	}
	const collects = commands.some(({ op }) => op !== SharedCommandKind.Ungroup);
	const junction = endpoints.find(({ endpointKind }) => endpointKind === EndpointKind.Junction);
	if (!collects && junction !== undefined)
		commands.push({
			op: SharedCommandKind.Delete,
			target: { kind: SharedElementKind.Junction, id: junction.endpointId },
		});
	return commands;
}
