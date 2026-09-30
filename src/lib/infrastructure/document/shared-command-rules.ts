import { collectJunctions } from '../../core/document/collect-junctions';
import { placeJunctions } from '../../core/document/junction-placement';
import {
	contentStyleFields,
	defined,
	type LogicDocument,
	nodeDescriptionFields,
	parallelRelation,
} from '../../core/document/logic-document';
import { projectNodeAddition, projectRelationAddition } from '../../core/document/topology-edits';
import { fractionalOrderKeySpace } from '../../core/ordering/order-key-space';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
} from './shared-document-command';

export function sharedElementOrder(id: string): string {
	return fractionalOrderKeySpace.keyFor({}, id);
}

/** Moving an endpoint must not repeat another relation's source and target. */
function finalizeUpdatedElement(
	document: LogicDocument,
	command: SharedDocumentCommand,
): LogicDocument {
	if (command.op !== SharedCommandKind.Update) return document;
	if (command.target.kind !== SharedElementKind.Relation) return document;
	const relationId = command.target.id;
	const relation = defined(document.relations.find(({ id }) => id === relationId));
	const existing = parallelRelation(document.relations, relation);
	if (existing !== undefined)
		throw new Error(`Relation ${relation.from} → ${relation.to} already exists: ${existing.id}`);
	return document;
}

function finalizedCommand(
	before: LogicDocument,
	after: LogicDocument,
	command: SharedDocumentCommand,
): LogicDocument {
	if (command.op === SharedCommandKind.DeleteRelations) return collectJunctions(after);
	if (command.op === SharedCommandKind.Delete) {
		if (command.target.kind === SharedElementKind.Nature) return after;
		return collectJunctions(after);
	}
	if (command.op !== SharedCommandKind.Create) return finalizeUpdatedElement(after, command);
	let result;
	if (command.target.kind === SharedElementKind.Node) {
		const node = defined(after.nodes.find(({ id }) => id === command.target.id));
		let newNode = {
			id: node.id,
			natureId: node.natureId,
			markdown: node.markdown,
			...nodeDescriptionFields(node.description),
			...contentStyleFields(node.color, node.icon),
		};
		if (node.groupId !== undefined) newNode = Object.assign(newNode, { groupId: node.groupId });
		if (node.laneId !== undefined) newNode = Object.assign(newNode, { laneId: node.laneId });
		if (node.regionId !== undefined) newNode = Object.assign(newNode, { regionId: node.regionId });
		result = projectNodeAddition(before, newNode, fractionalOrderKeySpace);
	}
	if (command.target.kind === SharedElementKind.Relation) {
		const relation = defined(after.relations.find(({ id }) => id === command.target.id));
		result = projectRelationAddition(before, relation, fractionalOrderKeySpace);
	}
	if (result === undefined) return after;
	if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
	return result.value.document;
}

/**
 * Use the same ordering and junction collection as local document commands; every surviving
 * junction then follows its targets, whichever command moved, grouped or rewired them.
 */
export function finalizeSharedCommand(
	before: LogicDocument,
	after: LogicDocument,
	command: SharedDocumentCommand,
): LogicDocument {
	return placeJunctions(finalizedCommand(before, after, command));
}
