import * as Y from 'yjs';

import { SharedElementKind, type SharedTarget } from '../document/shared-document-command';
import { sharedElement } from './shared-element';
import { spliceSharedText } from './shared-text';
import { YjsCollection } from './yjs-document-schema';

interface TextIntent {
	readonly target: SharedTarget;
	readonly field: string;
	readonly base: string;
	readonly next: string;
}

const COLLECTIONS: readonly [SharedElementKind, YjsCollection][] = [
	[SharedElementKind.Node, YjsCollection.Nodes],
	[SharedElementKind.Group, YjsCollection.Groups],
	[SharedElementKind.Nature, YjsCollection.Natures],
];

function key(target: SharedTarget, field: string): string {
	return `${target.kind}:${target.id}:${field}`;
}

export function sharedTextAt(
	document: Y.Doc,
	target: SharedTarget,
	field: string,
): Y.Text | undefined {
	try {
		const value = sharedElement(document, target).get(field);
		if (value instanceof Y.Text) return value;
	} catch {
		// A peer can remove the entity between editing and rebasing.
	}
	return undefined;
}

/** Returns the position of a locally changed span only when it is unambiguous in the new authority. */
interface RebasedSpan {
	readonly offset: number;
	readonly removed: string;
	readonly inserted: string;
}

function rebasePosition(intent: TextIntent, current: string): RebasedSpan | undefined {
	let prefix = 0;
	const commonPrefixLimit = Math.min(intent.base.length, intent.next.length);
	while (prefix < commonPrefixLimit) {
		if (intent.base[prefix] !== intent.next[prefix]) break;
		prefix++;
	}
	let suffix = 0;
	const suffixLimit = Math.min(intent.base.length, intent.next.length) - prefix;
	while (suffix < suffixLimit) {
		const baseCharacter = intent.base.at(-suffix - 1);
		const nextCharacter = intent.next.at(-suffix - 1);
		if (baseCharacter !== nextCharacter) break;
		suffix++;
	}
	const removed = intent.base.slice(prefix, intent.base.length - suffix);
	const inserted = intent.next.slice(prefix, intent.next.length - suffix);
	if (current === intent.base) return { offset: prefix, removed, inserted };
	if (removed.length === 0) return undefined; // No unique insertion anchor; keep a recoverable draft.
	const offset = current.indexOf(removed);
	if (offset < 0 || current.includes(removed, offset + 1)) return undefined;
	return { offset, removed, inserted };
}

/** Text intentions survive replacement of the Y.Doc, never the old CRDT structs. */
export class TextIntentLedger {
	readonly #entries = new Map<string, TextIntent>();

	record(target: SharedTarget, field: string, base: string, next: string): void {
		const id = key(target, field);
		const prior = this.#entries.get(id);
		this.#entries.set(id, { target, field, base: prior?.base ?? base, next });
	}

	#collectEntity(
		values: Map<string, TextIntent>,
		target: SharedTarget,
		entity: Y.Map<unknown>,
	): void {
		for (const [field, value] of entity) {
			if (!(value instanceof Y.Text)) continue;
			values.set(key(target, field), { target, field, base: '', next: value.toJSON() });
		}
	}

	applyComposition(document: Y.Doc, update: Uint8Array, origin: unknown): void {
		const before = this.values(document);
		Y.applyUpdate(document, update, origin);
		for (const [id, after] of this.values(document)) {
			const previous = before.get(id);
			if (previous === undefined) continue;
			if (previous.next !== after.next)
				this.record(after.target, after.field, previous.next, after.next);
		}
	}

	edit(
		document: Y.Doc,
		input: { target: SharedTarget; field: string; next: string; origin: unknown },
	): boolean {
		const { target, field, next, origin } = input;
		const text = sharedTextAt(document, target, field);
		if (text === undefined) return false;
		this.record(target, field, text.toJSON(), next);
		document.transact(() => {
			spliceSharedText(text, next);
		}, origin);
		return true;
	}

	values(document: Y.Doc): Map<string, TextIntent> {
		const values = new Map<string, TextIntent>();
		for (const [kind, collection] of COLLECTIONS)
			for (const [id, entity] of document.getMap<Y.Map<unknown>>(collection))
				this.#collectEntity(values, { kind, id }, entity);
		const meta = document.getMap(YjsCollection.Meta);
		const id = meta.get('id');
		const title = meta.get('title');
		if (typeof id === 'string') {
			if (title instanceof Y.Text) {
				const target = { kind: SharedElementKind.Document, id };
				values.set(key(target, 'title'), {
					target,
					field: 'title',
					base: '',
					next: title.toJSON(),
				});
			}
		}
		return values;
	}

	targets(): readonly SharedTarget[] {
		const targets = new Map<string, SharedTarget>();
		for (const { target } of this.#entries.values())
			targets.set(`${target.kind}:${target.id}`, target);
		return [...targets.values()];
	}

	restore(document: Y.Doc, report: (message: string) => void): void {
		for (const [id, intent] of this.#entries) {
			this.#entries.delete(id);
			const text = sharedTextAt(document, intent.target, intent.field);
			if (text === undefined) continue; // The server's deletion wins.
			const current = text.toJSON();
			if (current === intent.next) continue;
			const position = rebasePosition(intent, current);
			if (position === undefined) {
				report(
					`La saisie de ${intent.target.id} chevauche une édition distante. Brouillon à récupérer : ${intent.next}`,
				);
				continue;
			}
			document.transact(() => {
				text.delete(position.offset, position.removed.length);
				text.insert(position.offset, position.inserted);
			});
		}
	}

	clear(): void {
		this.#entries.clear();
	}
}
