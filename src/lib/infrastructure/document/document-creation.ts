import type { LogicDocument } from '../../core/document/logic-document';

export const UNTITLED_DOCUMENT_TITLE = 'Sans titre';

/** A fresh document keeping the natures and layout preferences of the current one. */
export function emptyDocument(document: LogicDocument, id: string): LogicDocument {
	return {
		...document,
		id,
		title: UNTITLED_DOCUMENT_TITLE,
		nodes: [],
		groups: [],
		junctions: [],
		relations: [],
	};
}
