import {
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../core/document/logic-document';
import { defaultNatures } from '../../core/document/nature-families';

export const UNTITLED_DOCUMENT_TITLE = 'Sans titre';

/** A fresh local document for a first visit, before any browser storage can be read. */
export function blankDocument(id: string): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id,
		title: UNTITLED_DOCUMENT_TITLE,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: defaultNatures(),
		nodes: [],
		groups: [],
		junctions: [],
		relations: [],
	};
}

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
