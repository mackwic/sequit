import * as Y from 'yjs';

import { isSharedTextField } from './shared-text';
import { YjsCollection } from './yjs-document-schema';

function collectTexts(document: Y.Doc): ReadonlySet<Y.Text> {
	const texts = new Set<Y.Text>();
	const visit = (map: Y.Map<unknown>): void => {
		for (const [key, value] of map) {
			if (value instanceof Y.Map) visit(value);
			else if (value instanceof Y.Text && isSharedTextField(key)) texts.add(value);
		}
	};
	for (const collection of Object.values(YjsCollection)) visit(document.getMap(collection));
	return texts;
}

/** Deleted node content stays in Yjs history with gc:false; it cannot recreate the node. */
function isDeletedNodeText(candidate: Y.Doc, text: Y.Text): boolean {
	const field = text._item;
	if (field === null) return false;
	if (!['markdown', 'description'].includes(field.parentSub ?? '')) return false;
	if (!field.deleted) return false;
	const node = field.parent;
	if (!(node instanceof Y.Map)) return false;
	const owner = node._item;
	if (owner?.deleted !== true) return false;
	const nodes = candidate.getMap(YjsCollection.Nodes);
	if (owner.parent !== nodes) return false;
	if (typeof owner.parentSub !== 'string') return false;
	return !nodes.has(owner.parentSub);
}

function assertTextItem(
	item: Y.AbstractStruct,
	texts: ReadonlySet<Y.Text>,
	candidate: Y.Doc,
): void {
	if (!(item instanceof Y.Item)) throw new Error('Text update contains non-text data');
	const plainText =
		item.content instanceof Y.ContentString || item.content instanceof Y.ContentDeleted;
	if (!plainText || item.parentSub !== null) throw new Error('Only plain text edits are allowed');
	if (!(item.parent instanceof Y.Text))
		throw new Error('Use a command to change document properties');
	if (!texts.has(item.parent)) {
		if (isDeletedNodeText(candidate, item.parent)) return;
		throw new Error('Text update targets an undeclared or live-inaccessible field');
	}
}

/** Run on an isolated candidate. Rejected structs never enter the room's document. */
export function applyTextUpdate(candidate: Y.Doc, update: Uint8Array): void {
	const texts = collectTexts(candidate);
	const before = Y.decodeStateVector(Y.encodeStateVector(candidate));
	const check = (transaction: Y.Transaction): void => {
		for (const type of transaction.changed.keys()) {
			if (!(type instanceof Y.Text)) throw new Error('Use a command to change document structure');
			if (!texts.has(type) && !isDeletedNodeText(candidate, type))
				throw new Error('Text update targets an undeclared field');
		}
	};
	candidate.on('afterTransaction', check);
	try {
		Y.applyUpdate(candidate, update);
	} finally {
		candidate.off('afterTransaction', check);
	}
	if (candidate.store.pendingStructs !== null || candidate.store.pendingDs !== null)
		throw new Error('Text update has unresolved dependencies');
	for (const [client, structs] of candidate.store.clients) {
		const clock = before.get(client) ?? 0;
		for (const item of structs) {
			if (item.id.clock + item.length > clock) assertTextItem(item, texts, candidate);
		}
	}
}
