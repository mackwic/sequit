import * as Y from 'yjs';

import { TerminalSessionFailure } from './session-failure';
import { SessionFailureCode } from './session-reasons';
import type { TextTargetReference } from './session-wire';
import { isEditableSharedTextField, sharedTextAt } from './shared-element';
import { isSharedTextField } from './shared-text';
import { YjsCollection } from './yjs-document-schema';

function invalidDocument(detail: string): never {
	throw new TerminalSessionFailure(SessionFailureCode.InvalidDocument, {
		code: SessionFailureCode.InvalidDocument,
		details: [detail],
	});
}

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
		invalidDocument('Text proposal targets a non-editable field.');
	if (update.structs.length === 0 && update.ds.clients.size === 0)
		invalidDocument('Text proposal contains no changes.');
	for (const struct of update.structs) {
		if (!plainTextContent(struct))
			invalidDocument('Text proposal contains a structural modification.');
		if (struct.parentSub !== null)
			invalidDocument('Text proposal contains a structural modification.');
		if (typeof struct.parent === 'string')
			invalidDocument('Text proposal contains a structural modification.');
	}
}

function assertTextItem(item: Y.AbstractStruct, texts: ReadonlySet<Y.Text>): void {
	if (!(item instanceof Y.Item)) invalidDocument('Text update contains a non-text item.');
	const plainText =
		item.content instanceof Y.ContentString || item.content instanceof Y.ContentDeleted;
	if (!plainText || item.parentSub !== null)
		invalidDocument('Text update contains a non-text edit.');
	if (!(item.parent instanceof Y.Text))
		invalidDocument('Text update attempts to change a document property.');
	if (!texts.has(item.parent))
		invalidDocument('Text update targets an undeclared or inaccessible field.');
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
			if (!(type instanceof Y.Text))
				invalidDocument('Text update attempts to change document structure.');
			if (!texts.has(type)) invalidDocument('Text update targets an undeclared field.');
		}
	};
	candidate.on('afterTransaction', check);
	try {
		Y.applyUpdate(candidate, update);
	} finally {
		candidate.off('afterTransaction', check);
	}
	if (candidate.store.pendingStructs !== null || candidate.store.pendingDs !== null)
		invalidDocument('Text update has unresolved dependencies.');
	for (const [client, structs] of candidate.store.clients) {
		const clock = before.get(client) ?? 0;
		for (const item of structs) {
			if (item.id.clock + item.length > clock) assertTextItem(item, texts);
		}
	}
}
