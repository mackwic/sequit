import * as Y from 'yjs';

/** Compact deleted Yjs history after a proposal has passed the text boundary. */
export function compactRoomDocument(document: Y.Doc): void {
	Y.tryGc(Y.createDeleteSetFromStructStore(document.store), document.store, (item) =>
		document.gcFilter(item),
	);
}
