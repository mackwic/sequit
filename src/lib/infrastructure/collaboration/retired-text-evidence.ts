import * as Y from 'yjs';

import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	type SharedTarget,
} from '../document/shared-document-command';
import type { TextTargetReference } from './session-wire';
import { isEditableSharedTextField, sharedTextAt } from './shared-element';
import { assertLiveTextTarget, TextTargetGoneError } from './text-update-validation';

const MAX_RETIRED_FIELDS = 128;
const MAX_FIELD_SPANS = 256;

type DecodedUpdate = ReturnType<typeof Y.decodeUpdate>;

interface Span {
	readonly client: number;
	readonly clock: number;
	readonly length: number;
}

interface RetiredText {
	readonly target: SharedTarget;
	readonly field: string;
	readonly textId: Y.ID;
	readonly spans: readonly Span[];
}

function textFields(kind: SharedElementKind): readonly string[] {
	if (kind === SharedElementKind.Node) return ['markdown', 'description'];
	if (kind === SharedElementKind.Group || kind === SharedElementKind.Nature) return ['label'];
	return [];
}

function recordText(
	before: Y.Doc,
	after: Y.Doc,
	target: SharedTarget,
	field: string,
): RetiredText | undefined {
	const text = sharedTextAt(before, target, field);
	const textId = text?._item?.id;
	if (text === undefined || textId === undefined) return undefined;
	if (sharedTextAt(after, target, field) === text) return undefined;
	const spans: Span[] = [];
	for (let item = text._start; item !== null; item = item.right) {
		if (spans.length === MAX_FIELD_SPANS) return undefined;
		spans.push({ client: item.id.client, clock: item.id.clock, length: item.length });
	}
	return { target, field, textId, spans };
}

function covers(spans: readonly Span[], id: Y.ID, length = 1): boolean {
	let clock = id.clock;
	const end = clock + length;
	while (clock < end) {
		const span = spans.find((entry) => {
			if (entry.client !== id.client || entry.clock > clock) return false;
			return clock < entry.clock + entry.length;
		});
		if (span === undefined) return false;
		clock = Math.min(end, span.clock + span.length);
	}
	return true;
}

function parentId(parent: Y.Item['parent']): Y.ID | undefined {
	if (typeof parent !== 'object') return undefined;
	if (parent === null) return undefined;
	if ('client' in parent) return parent;
	return undefined;
}

function textItem(item: Y.AbstractStruct): item is Y.Item {
	if (!(item instanceof Y.Item)) return false;
	if (item.parentSub !== null) return false;
	return item.content instanceof Y.ContentString || item.content instanceof Y.ContentDeleted;
}

function matchesAnchor(anchor: Y.ID | null, spans: readonly Span[]): boolean {
	if (anchor === null) return true;
	return covers(spans, anchor);
}

function isRooted(item: Y.Item, textId: Y.ID, spans: readonly Span[]): boolean | undefined {
	const parent = parentId(item.parent);
	if (parent !== undefined) {
		if (parent.client !== textId.client || parent.clock !== textId.clock) return false;
	}
	if (!matchesAnchor(item.origin, spans) || !matchesAnchor(item.rightOrigin, spans))
		return undefined;
	if (parent !== undefined) return true;
	return item.origin !== null || item.rightOrigin !== null;
}

function validateStructs(update: DecodedUpdate, entry: RetiredText, spans: Span[]): boolean {
	let pending: readonly Y.AbstractStruct[] = update.structs;
	while (pending.length > 0) {
		const unresolved: Y.AbstractStruct[] = [];
		for (const struct of pending) {
			if (!textItem(struct)) return false;
			const rooted = isRooted(struct, entry.textId, spans);
			if (rooted === false) return false;
			if (rooted === undefined) {
				unresolved.push(struct);
				continue;
			}
			spans.push({ client: struct.id.client, clock: struct.id.clock, length: struct.length });
		}
		if (unresolved.length === pending.length) return false;
		pending = unresolved;
	}
	return true;
}

function validateDeletions(update: DecodedUpdate, spans: readonly Span[]): boolean {
	for (const [client, ranges] of update.ds.clients) {
		for (const range of ranges)
			if (!covers(spans, { client, clock: range.clock }, range.len)) return false;
	}
	return true;
}

/** Ephemeral evidence: an evicted room deliberately fails closed instead of persisting tombstones. */
export class RoomRetiredTexts {
	readonly #fields = new Map<string, RetiredText>();

	capture(before: Y.Doc, after: Y.Doc, commands: readonly SharedDocumentCommand[]): RetiredText[] {
		const retired: RetiredText[] = [];
		for (const command of commands) {
			let target: SharedTarget;
			if (command.op === SharedCommandKind.Delete) target = command.target;
			else if (command.op === SharedCommandKind.Ungroup)
				target = { kind: SharedElementKind.Group, id: command.id };
			else continue;
			for (const field of textFields(target.kind)) {
				const entry = recordText(before, after, target, field);
				if (entry !== undefined) retired.push(entry);
			}
		}
		return retired;
	}

	remember(retired: readonly RetiredText[]): void {
		for (const entry of retired) {
			const key = `${entry.textId.client}:${entry.textId.clock}`;
			this.#fields.delete(key);
			this.#fields.set(key, entry);
			if (this.#fields.size > MAX_RETIRED_FIELDS) {
				const first = this.#fields.keys().next().value;
				if (first !== undefined) this.#fields.delete(first);
			}
		}
	}

	/** Only an authentic old incarnation can turn an invalid target into a soft refusal. */
	liveOrRetired(document: Y.Doc, reference: TextTargetReference, update: DecodedUpdate): boolean {
		const empty = update.structs.length === 0 && update.ds.clients.size === 0;
		if (!isEditableSharedTextField(reference.target.kind, reference.field) || empty)
			throw new Error('La proposition de texte est invalide.');
		try {
			assertLiveTextTarget(document, reference);
			return true;
		} catch (error) {
			if (!(error instanceof TextTargetGoneError)) throw error;
			if (!this.accepts(reference, update))
				throw new Error('La proposition ne provient pas du texte supprimé.', { cause: error });
			return false;
		}
	}

	/** Every inserted/deleted struct must descend from the claimed old field, not another live text. */
	private accepts(reference: TextTargetReference, update: DecodedUpdate): boolean {
		if (!isEditableSharedTextField(reference.target.kind, reference.field)) return false;
		const entry = this.#fields.get(`${reference.textId.client}:${reference.textId.clock}`);
		if (entry?.target.kind !== reference.target.kind) return false;
		if (entry.target.id !== reference.target.id || entry.field !== reference.field) return false;
		if (update.structs.length === 0 && update.ds.clients.size === 0) return false;
		const spans: Span[] = [...entry.spans];
		if (!validateStructs(update, entry, spans)) return false;
		return validateDeletions(update, spans);
	}
}
