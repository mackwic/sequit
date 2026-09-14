import * as Y from 'yjs';

/**
 * Validation candidates retain deleted structs until the text boundary has inspected them.
 * Only accepted candidates may discard their deleted payloads. Clocks and delete sets remain,
 * so existing replicas can still synchronize; this does not reconstruct a document or epoch.
 * Undo belongs to the client: its UndoManager retains the payloads needed for its own undo.
 */
export function compactRoomDocument(document: Y.Doc): void {
	Y.tryGc(Y.createDeleteSetFromStructStore(document.store), document.store, document.gcFilter);
}
