import * as Y from 'yjs';

import type { TextTargetReference } from './session-wire';
import { isEditableSharedTextField, sharedTextAt } from './shared-element';
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

class TextTargetGoneError extends Error {}

interface DecodedTextProposal {
	readonly structs: readonly Y.AbstractStruct[];
	readonly ds: { readonly clients: ReadonlyMap<number, unknown> };
}

interface TextDeletionRange {
	readonly clock: number;
	readonly len: number;
}

function plainTextContent(item: Y.AbstractStruct): item is Y.Item {
	if (!(item instanceof Y.Item)) return false;
	if (item.content instanceof Y.ContentString) return true;
	return item.content instanceof Y.ContentDeleted;
}

/** A reused node ID cannot authorize updates to the old Y.Text incarnation. */
export function isLiveTextTarget(document: Y.Doc, reference: TextTargetReference): boolean {
	const id = sharedTextAt(document, reference.target, reference.field)?._item?.id;
	return id?.client === reference.textId.client && id.clock === reference.textId.clock;
}

/** A missing incarnation is retryable only for syntactically plain edits to a permitted field. */
export function assertSyntacticTextProposal(
	reference: TextTargetReference,
	update: DecodedTextProposal,
): void {
	if (!isEditableSharedTextField(reference.target.kind, reference.field))
		throw new Error('La proposition de texte est invalide.');
	if (update.structs.length === 0 && update.ds.clients.size === 0)
		throw new Error('La proposition de texte est invalide.');
	for (const struct of update.structs) {
		if (!plainTextContent(struct))
			throw new Error('La proposition contient une modification structurelle.');
		if (struct.parentSub !== null)
			throw new Error('La proposition contient une modification structurelle.');
		if (typeof struct.parent === 'string')
			throw new Error('La proposition contient une modification structurelle.');
	}
}

function assertKnownDeletionRange(
	structs: readonly Y.AbstractStruct[],
	range: TextDeletionRange,
): void {
	const end = range.clock + range.len;
	for (const item of structs) {
		if (item.id.clock >= end) break;
		if (item.id.clock + item.length <= range.clock) continue;
		if (item instanceof Y.GC) continue;
		if (!plainTextContent(item))
			throw new Error('La proposition supprime une structure du document.');
		if (!(item.parent instanceof Y.Text))
			throw new Error('La proposition supprime une structure du document.');
	}
}

/** Reject delete-only changes to known structural items; compacted tombstones remain unknown. */
export function assertKnownTextDeletions(
	document: Y.Doc,
	deletions: ReadonlyMap<number, readonly TextDeletionRange[]>,
): void {
	for (const [client, ranges] of deletions) {
		const structs = document.store.clients.get(client);
		if (structs === undefined) continue;
		for (const range of ranges) assertKnownDeletionRange(structs, range);
	}
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
