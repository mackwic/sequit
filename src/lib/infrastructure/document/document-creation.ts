import type { LogicDocument } from '../../core/document/logic-document';
import { defaultNatures } from '../../core/document/nature-families';

export const UNTITLED_DOCUMENT_TITLE = 'Sans titre';

/** A fresh document with the default natures, keeping the layout preferences of the current one. */
export function emptyDocument(document: LogicDocument, id: string): LogicDocument {
	return {
		...document,
		id,
		title: UNTITLED_DOCUMENT_TITLE,
		natures: defaultNatures(),
		nodes: [],
		groups: [],
		junctions: [],
		relations: [],
	};
}
