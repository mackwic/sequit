export function wireObject(value: unknown): Record<string, unknown> {
	const objectType = typeof value === 'object';
	const invalidObject = !objectType || value === null;
	if (invalidObject || Array.isArray(value)) throw new Error('Expected an object');
	if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Expected a plain object');
	return Object.fromEntries(Object.entries(value));
}

export function wireString(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Expected a string');
	return value;
}

export function wireId(value: unknown): string {
	const id = wireString(value);
	if (id.length === 0 || new TextEncoder().encode(id).length > 128)
		throw new Error('ID must contain 1 to 128 bytes');
	return id;
}

export function wireStrings(value: unknown): string[] {
	if (!Array.isArray(value)) throw new Error('Expected an array');
	return value.map((item: unknown) => wireString(item));
}

export function wireProperties(value: unknown): Record<string, string> {
	return Object.fromEntries(
		Object.entries(wireObject(value)).map(([key, item]) => [key, wireString(item)]),
	);
}

export function wireBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new Error('Expected binary bytes');
	return value;
}

export function wireInteger(value: unknown): number {
	if (typeof value !== 'number') throw new Error('Expected a nonnegative safe integer');
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error('Expected a nonnegative safe integer');
	return value;
}

export function wireKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
	if (Object.keys(value).some((key) => !allowed.includes(key)))
		throw new Error('Unexpected message property');
}
