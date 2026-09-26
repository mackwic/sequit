import * as Y from 'yjs';

import { YjsCollection } from './yjs-document-schema';

/** Deleted node text needs its CRDT parent chain to authenticate late edits. */
function deletedNodeTextHistory(item: Y.Item, nodes: Y.Map<unknown>): boolean {
	if (item.parent === nodes)
		return item.content instanceof Y.ContentType && item.content.type instanceof Y.Map;
	const parent = item.parent;
	if (parent instanceof Y.Map) {
		if (parent._item?.parent !== nodes || !parent._item.deleted) return false;
		if (!['markdown', 'description'].includes(item.parentSub ?? '')) return false;
		return item.content instanceof Y.ContentType && item.content.type instanceof Y.Text;
	}
	if (!(parent instanceof Y.Text)) return false;
	const field = parent._item;
	const node = field?.parent;
	if (field === null) return false;
	if (!(node instanceof Y.Map)) return false;
	if (node._item?.parent !== nodes) return false;
	if (!node._item.deleted || !field.deleted) return false;
	return ['markdown', 'description'].includes(field.parentSub ?? '');
}

/**
 * Validation candidates retain deleted structs until the text boundary has inspected them.
 * Accepted candidates discard ordinary deleted payloads but keep deleted node-text ancestry.
 * Clocks and delete sets remain,
 * so existing replicas can still synchronize; this does not reconstruct a document or epoch.
 * Undo belongs to the client: its UndoManager retains the payloads needed for its own undo.
 */
export function compactRoomDocument(document: Y.Doc): void {
	const nodes = document.getMap(YjsCollection.Nodes);
	Y.tryGc(
		Y.createDeleteSetFromStructStore(document.store),
		document.store,
		(item) => document.gcFilter(item) && !deletedNodeTextHistory(item, nodes),
	);
}
