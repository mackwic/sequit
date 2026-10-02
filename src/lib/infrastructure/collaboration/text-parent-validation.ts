import * as Y from 'yjs';

import { SharedElementKind } from '../document/shared-document-command';
import { TerminalSessionFailure } from './session-failure';
import { SessionFailureCode } from './session-reasons';
import type { TextTargetReference } from './session-wire';
import { elementCollection } from './shared-element';
import { YjsCollection } from './yjs-document-schema';

function invalidDocument(detail: string): never {
	throw new TerminalSessionFailure(SessionFailureCode.InvalidDocument, {
		code: SessionFailureCode.InvalidDocument,
		details: [detail],
	});
}

interface TextDeletionRange {
	readonly clock: number;
	readonly len: number;
}

interface ParentContext {
	readonly document: Y.Doc;
	readonly proposed: ReadonlyMap<number, readonly Y.AbstractStruct[]>;
	readonly maximumDepth: number;
}

type Parent = Y.AbstractType<unknown> | null | false;

function inProposed(
	structs: readonly Y.AbstractStruct[],
	clock: number,
): Y.AbstractStruct | undefined {
	let left = 0;
	let right = structs.length - 1;
	while (left <= right) {
		const middle = (left + right) >>> 1;
		const struct = structs[middle];
		if (struct === undefined) return undefined;
		if (clock < struct.id.clock) right = middle - 1;
		else if (clock >= struct.id.clock + struct.length) left = middle + 1;
		else return struct;
	}
	return undefined;
}

function structAt(context: ParentContext, id: Y.ID): Y.AbstractStruct | undefined {
	const stored = context.document.store.clients.get(id.client);
	if (stored !== undefined && id.clock < Y.getState(context.document.store, id.client))
		return stored[Y.findIndexSS(stored, id.clock)];
	const proposed = context.proposed.get(id.client);
	if (proposed === undefined) return undefined;
	return inProposed(proposed, id.clock);
}

function compacted(context: ParentContext, struct: Y.AbstractStruct | undefined): boolean {
	if (struct instanceof Y.GC) return true;
	if (!(struct instanceof Y.Item)) return false;
	if (!(struct.content instanceof Y.ContentDeleted)) return false;
	// Yjs can replace content without erasing an integrated item's known parent.
	if (struct.id.clock >= Y.getState(context.document.store, struct.id.client)) return false;
	return !(struct.parent instanceof Y.AbstractType);
}

function typeFromAnchor(context: ParentContext, id: Y.ID, depth: number): Parent {
	const struct = structAt(context, id);
	if (compacted(context, struct)) return null;
	if (!(struct instanceof Y.Item)) return false;
	if (struct.parent instanceof Y.AbstractType) return struct.parent;
	return parentOf(context, struct, depth + 1);
}

function typeFromParentId(context: ParentContext, id: Y.ID): Parent {
	const struct = structAt(context, id);
	if (compacted(context, struct)) return null;
	if (!(struct instanceof Y.Item)) return false;
	if (struct.content instanceof Y.ContentDeleted) {
		// GC may erase a container's type while preserving its owning map.
		if (struct.id.clock < Y.getState(context.document.store, struct.id.client)) return null;
		return false; // A proposed deletion is not a container for later items.
	}
	if (!(struct.content instanceof Y.ContentType)) return false;
	return struct.content.type;
}

function parentOf(context: ParentContext, item: Y.Item, depth: number): Parent {
	if (depth > context.maximumDepth) return false;
	const parent = item.parent;
	if (parent instanceof Y.AbstractType) return parent;
	if (parent !== null) {
		if (typeof parent === 'string') return false;
		return typeFromParentId(context, parent);
	}
	const anchor = item.origin ?? item.rightOrigin;
	if (anchor === null) return false;
	return typeFromAnchor(context, anchor, depth);
}

function declaredText(
	context: ParentContext,
	reference: TextTargetReference,
	parent: Parent,
): void {
	if (parent === null) return; // GC erased the authoritative ancestor, not just its payload.
	if (!(parent instanceof Y.Text)) invalidDocument('Text update parent is not a Y.Text.');
	const textItem = parent._item;
	if (textItem === null) invalidDocument('Text target is not integrated.');
	const stored = structAt(context, textItem.id);
	if (compacted(context, stored)) return;
	if (!(stored instanceof Y.Item)) invalidDocument('Text target item is unknown.');
	if (
		textItem.id.client !== reference.textId.client ||
		textItem.id.clock !== reference.textId.clock
	)
		invalidDocument('Text target ID does not match the referenced field.');
	if (textItem.parentSub !== reference.field)
		invalidDocument('Text target field does not match the referenced field.');
	const owner = textItem.parent;
	if (!(owner instanceof Y.Map)) invalidDocument('Text target parent is not a declared Y.Map.');
	if (reference.target.kind === SharedElementKind.Document) {
		if (
			owner !== context.document.getMap(YjsCollection.Meta) ||
			owner.get('id') !== reference.target.id
		)
			invalidDocument('Text title belongs to another document.');
		return;
	}
	const ownerItem = owner._item;
	if (ownerItem === null) invalidDocument('Text target entity is not integrated.');
	if (compacted(context, structAt(context, ownerItem.id))) return;
	if (ownerItem.parentSub !== reference.target.id)
		invalidDocument('Text target belongs to another entity.');
	if (ownerItem.parent !== elementCollection(context.document, reference.target.kind))
		invalidDocument('Text target belongs to another collection.');
}

function contextFor(document: Y.Doc, structs: readonly Y.AbstractStruct[]): ParentContext {
	const proposed = new Map<number, Y.AbstractStruct[]>();
	for (const struct of structs) {
		const previous = proposed.get(struct.id.client);
		if (previous === undefined) proposed.set(struct.id.client, [struct]);
		else previous.push(struct);
	}
	return { document, proposed, maximumDepth: structs.length };
}

/** Resolve every authoritative parent, including deleted items; only GC-erased ancestry is ambiguous. */
export function assertTextStructParents(
	document: Y.Doc,
	reference: TextTargetReference,
	structs: readonly Y.AbstractStruct[],
): void {
	const context = contextFor(document, structs);
	for (const struct of structs) {
		if (!(struct instanceof Y.Item)) invalidDocument('Text proposal contains a structural item.');
		const parent = parentOf(context, struct, 0);
		declaredText(context, reference, parent);
		if (struct.parent !== null) continue;
		if (struct.origin !== null && struct.rightOrigin !== null)
			declaredText(context, reference, typeFromAnchor(context, struct.rightOrigin, 0));
	}
}

function assertDeletionRange(
	context: ParentContext,
	reference: TextTargetReference,
	structs: readonly Y.AbstractStruct[],
	range: TextDeletionRange,
): void {
	const end = range.clock + range.len;
	for (const item of structs) {
		if (item.id.clock >= end) break;
		if (item.id.clock + item.length <= range.clock) continue;
		if (compacted(context, item)) continue;
		if (!(item instanceof Y.Item)) invalidDocument('Text deletion targets a structural item.');
		const textContent =
			item.content instanceof Y.ContentString || item.content instanceof Y.ContentDeleted;
		if (!textContent) invalidDocument('Text deletion targets non-text content.');
		if (!(item.parent instanceof Y.AbstractType))
			invalidDocument('Text deletion parent is unknown.');
		declaredText(context, reference, item.parent);
	}
}

/** A deletion of a known non-text item is terminal; GC has erased its parent evidence. */
export function assertKnownTextDeletions(
	document: Y.Doc,
	reference: TextTargetReference,
	deletions: ReadonlyMap<number, readonly TextDeletionRange[]>,
): void {
	const context = contextFor(document, []);
	for (const [client, ranges] of deletions) {
		const structs = document.store.clients.get(client);
		if (structs === undefined) invalidDocument('Text deletion targets unknown history.');
		for (const range of ranges) assertDeletionRange(context, reference, structs, range);
	}
}
