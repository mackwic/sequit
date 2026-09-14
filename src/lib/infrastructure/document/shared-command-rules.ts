import { collectJunctions } from '../../core/document/collect-junctions';
import {
	contentStyleFields,
	defined,
	type LogicDocument,
	nodeDescriptionFields,
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

/** Use the same ordering and junction collection as local document commands. */
export function finalizeSharedCommand(
	before: LogicDocument,
	after: LogicDocument,
	command: SharedDocumentCommand,
): LogicDocument {
	if (command.op === SharedCommandKind.DeleteRelations) return collectJunctions(after);
	if (command.op === SharedCommandKind.Delete) {
		if (command.target.kind === SharedElementKind.Nature) return after;
		return collectJunctions(after);
	}
	if (command.op !== SharedCommandKind.Create) return after;
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
