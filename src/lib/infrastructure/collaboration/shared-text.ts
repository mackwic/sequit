import diff from 'fast-diff';
import * as Y from 'yjs';

/** Apply only changed spans, preserving CRDT identities between separate Markdown edits. */
export function spliceSharedText(text: Y.Text, next: string): void {
	let index = 0;
	for (const [kind, value] of diff(text.toJSON(), next)) {
		if (kind === -1) text.delete(index, value.length);
		else {
			if (kind === 1) text.insert(index, value);
			index += value.length;
		}
	}
}

export function isSharedTextField(key: string): boolean {
	return ['markdown', 'description', 'title', 'label'].includes(key);
}

export function sharedFieldValue(key: string, value: unknown): unknown {
	if (isSharedTextField(key) && typeof value === 'string') return new Y.Text(value);
	return value;
}

export function syncSharedFields(
	target: Y.Map<unknown>,
	values: Readonly<Record<string, unknown>>,
): void {
	for (const key of target.keys()) if (!(key in values)) target.delete(key);
	for (const [key, value] of Object.entries(values)) {
		const current = target.get(key);
		const textValue = typeof value === 'string';
		if (current instanceof Y.Text && textValue) spliceSharedText(current, value);
		else if (current !== value) target.set(key, sharedFieldValue(key, value));
	}
}
