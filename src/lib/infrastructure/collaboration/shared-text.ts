import * as Y from 'yjs';

function splitsSurrogatePair(value: string, index: number): boolean {
	const before = value.charCodeAt(index - 1);
	const after = value.charCodeAt(index);
	const high = before >= 0xd800 && before <= 0xdbff;
	const low = after >= 0xdc00 && after <= 0xdfff;
	return high && low;
}

/** Preserve the unchanged characters and their CRDT identities. */
export function spliceSharedText(text: Y.Text, next: string): void {
	const previous = text.toJSON();
	let start = 0;
	while (start < previous.length && previous[start] === next[start]) start += 1;
	if (splitsSurrogatePair(previous, start) || splitsSurrogatePair(next, start)) start -= 1;
	let end = previous.length;
	let nextEnd = next.length;
	while (end > start && nextEnd > start) {
		const lastPrevious = previous[end - 1];
		const lastNext = next[nextEnd - 1];
		if (lastPrevious !== lastNext) break;
		end -= 1;
		nextEnd -= 1;
	}
	if (splitsSurrogatePair(previous, end) || splitsSurrogatePair(next, nextEnd)) {
		end += 1;
		nextEnd += 1;
	}
	if (end > start) text.delete(start, end - start);
	if (nextEnd > start) text.insert(start, next.slice(start, nextEnd));
}

export function isSharedTextField(key: string): boolean {
	return ['markdown', 'title', 'label'].includes(key);
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
