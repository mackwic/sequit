import * as Y from 'yjs';

import type { TextTargetReference } from './session-wire';
import { sharedTextAt } from './shared-element';
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

export class TextTargetGoneError extends Error {}

/** A reused node ID cannot authorize updates to the old Y.Text incarnation. */
export function assertLiveTextTarget(document: Y.Doc, reference: TextTargetReference): void {
	const current = sharedTextAt(document, reference.target, reference.field);
	const id = current?._item?.id;
	if (id?.client !== reference.textId.client || id.clock !== reference.textId.clock)
		throw new TextTargetGoneError('La cible de texte a été supprimée ou remplacée.');
}

function assertTextItem(item: Y.AbstractStruct, texts: ReadonlySet<Y.Text>): void {
	if (!(item instanceof Y.Item)) throw new Error('Text update contains non-text data');
	const plainText =
		item.content instanceof Y.ContentString || item.content instanceof Y.ContentDeleted;
	if (!plainText || item.parentSub !== null) throw new Error('Only plain text edits are allowed');
	if (!(item.parent instanceof Y.Text))
		throw new Error('Use a command to change document properties');
	if (!texts.has(item.parent))
		throw new Error('Text update targets an undeclared or live-inaccessible field');
}

/** Run on an isolated candidate. Rejected structs never enter the room's document. */
export function applyTextUpdate(
	candidate: Y.Doc,
	update: Uint8Array,
	reference?: TextTargetReference,
): void {
	const text = reference && sharedTextAt(candidate, reference.target, reference.field);
	if (reference !== undefined && text === undefined) throw new TextTargetGoneError();
	let texts: ReadonlySet<Y.Text>;
	if (text === undefined) texts = collectTexts(candidate);
	else texts = new Set([text]);
	const before = Y.decodeStateVector(Y.encodeStateVector(candidate));
	const check = (transaction: Y.Transaction): void => {
		for (const type of transaction.changed.keys()) {
			if (!(type instanceof Y.Text)) throw new Error('Use a command to change document structure');
			if (!texts.has(type)) throw new Error('Text update targets an undeclared field');
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
			if (item.id.clock + item.length > clock) assertTextItem(item, texts);
		}
	}
}
