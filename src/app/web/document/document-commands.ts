import {
	EndpointKind,
	type LogicDocument,
	type LogicRelation,
	type NewLogicNode,
} from '../../../lib/core/document/logic-document';
import { projectDeletion } from '../../../lib/core/document/topology-deletions';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
} from '../../../lib/infrastructure/document/shared-document-command';

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
 * Deletes a selection with its group descendants and every incident relation. Relations go first
 * so no later removal finds a missing target; an emptied group is then dissolved.
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
): readonly SharedDocumentCommand[] {
	const changes = projectDeletion(document, endpointIds, relationIds);
	const commands: SharedDocumentCommand[] = [];
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
