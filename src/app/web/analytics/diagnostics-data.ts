export const REDACTED = '[redacted]';

export function plainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null) return false;
	if (typeof value !== 'object') return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return false;
	}
	return true;
}

export function plainArray(value: unknown): value is unknown[] {
	if (!Array.isArray(value)) return false;
	if (Object.getPrototypeOf(value) !== Array.prototype) return false;
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return false;
	}
	return true;
}

export function ownValue(record: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (descriptor === undefined) return undefined;
	if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Accessor property');
	return descriptor.value;
}

export function safeUuid(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	return /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(value);
}

export function safeToken(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	return /^phc_[\w-]{1,128}$/u.test(value);
}

export function safeRoute(readRoute: () => string | null): string | null {
	const value: unknown = readRoute();
	if (typeof value !== 'string') return null;
	if (value.length > 200) return null;
	if (!/^\/[\w/()[\].=-]*$/u.test(value) || value.startsWith('//')) return null;
	const segments = value.split('/');
	if (segments.some((segment) => segment === '.' || segment === '..')) return null;
	if (segments.includes('atelier')) return null;
	return value;
}

export function safeTimestamp(value: unknown): Date | undefined {
	if (!(value instanceof Date)) return undefined;
	const milliseconds = Date.prototype.getTime.call(value);
	if (!Number.isFinite(milliseconds)) return undefined;
	return new Date(milliseconds);
}
