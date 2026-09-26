import * as Y from 'yjs';

import { ConflictCode, SessionConflict } from './session-failure';
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

export class TextTargetGoneError extends SessionConflict {
	constructor(text?: Y.Text) {
		const owner = text?._item?.parent;
		let targetId: string | undefined;
		if (owner instanceof Y.Map) targetId = owner._item?.parentSub ?? undefined;
		super(ConflictCode.TextTargetGone, 'Text target is no longer available', targetId);
	}
}

function originalStruct(
	item: Y.AbstractStruct,
	incoming: readonly Y.AbstractStruct[],
): Y.AbstractStruct | undefined {
	return incoming.find((struct) => {
		if (struct.id.client !== item.id.client) return false;
		if (struct.id.clock > item.id.clock) return false;
		return struct.id.clock + struct.length > item.id.clock;
	});
}

function assertOrphanGC(
	item: Y.GC,
	texts: ReadonlySet<Y.Text>,
	candidate: Y.Doc,
	incoming: readonly Y.AbstractStruct[],
): never {
	const original = originalStruct(item, incoming);
	if (!(original instanceof Y.Item)) throw new Error('Text update contains non-text data');
	if (!(original.content instanceof Y.ContentString))
		throw new Error('Text update contains non-text data');
	if (original.parentSub !== null) throw new Error('Text update contains non-text data');
	const anchor = original.origin ?? original.rightOrigin;
	if (anchor === null) throw new Error('Text update contains non-text data');
	const structs = candidate.store.clients.get(anchor.client);
	if (structs === undefined) throw new Error('Unknown text origin');
	const origin = structs[Y.findIndexSS(structs, anchor.clock)];
	if (origin instanceof Y.GC) throw new TextTargetGoneError();
	if (!(origin instanceof Y.Item)) throw new Error('Text update contains non-text data');
	if (!(origin.parent instanceof Y.Text)) throw new Error('Text update contains non-text data');
	if (texts.has(origin.parent)) throw new Error('Text update contains non-text data');
	if (!isSharedTextField(origin.parent._item?.parentSub ?? ''))
		throw new Error('Text update contains non-text data');
	throw new TextTargetGoneError(origin.parent);
}

function assertTextItem(
	item: Y.AbstractStruct,
	texts: ReadonlySet<Y.Text>,
	candidate: Y.Doc,
	incoming: readonly Y.AbstractStruct[],
): void {
	if (item instanceof Y.GC) assertOrphanGC(item, texts, candidate, incoming);
	if (!(item instanceof Y.Item)) throw new Error('Text update contains non-text data');
	const plainText =
		item.content instanceof Y.ContentString || item.content instanceof Y.ContentDeleted;
	if (!plainText || item.parentSub !== null) throw new Error('Only plain text edits are allowed');
	if (!(item.parent instanceof Y.Text))
		throw new Error('Use a command to change document properties');
	if (!texts.has(item.parent)) {
		if (!isSharedTextField(item.parent._item?.parentSub ?? ''))
			throw new Error('Text update targets an undeclared field');
		throw new TextTargetGoneError(item.parent);
	}
}

/** Run on an isolated candidate. Rejected structs never enter the room's document. */
export function applyTextUpdate(candidate: Y.Doc, update: Uint8Array): void {
	const texts = collectTexts(candidate);
	const incoming = Y.decodeUpdate(update).structs;
	const before = Y.decodeStateVector(Y.encodeStateVector(candidate));
	const check = (transaction: Y.Transaction): void => {
		for (const type of transaction.changed.keys()) {
			if (!(type instanceof Y.Text)) throw new Error('Use a command to change document structure');
			if (!texts.has(type)) throw new TextTargetGoneError(type);
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
			if (item.id.clock + item.length > clock) assertTextItem(item, texts, candidate, incoming);
		}
	}
}
