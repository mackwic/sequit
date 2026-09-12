import { WorkshopCommands } from '../../../src/app/workshop/runtime/workshop-commands';
import type { LogicDocument } from '../../../src/lib/core/document/logic-document';

export interface VisualDocumentEdit {
	readonly removeRelations?: readonly string[];
	readonly removeNodes?: readonly string[];
}

/** Use the actual workshop commands; never implement junction collection in the fixture. */
export function editVisualDocument(
	document: LogicDocument,
	edit?: VisualDocumentEdit,
): LogicDocument {
	let current = document;
	const commands = new WorkshopCommands(
		(change) => {
			current = change(current);
		},
		() => Promise.reject(new Error('This fixture only exercises deletion.')),
	);
	for (const id of edit?.removeRelations ?? []) commands.removeRelation(id);
	if (edit?.removeNodes !== undefined) commands.removeNodes(new Set(edit.removeNodes));
	return current;
}
