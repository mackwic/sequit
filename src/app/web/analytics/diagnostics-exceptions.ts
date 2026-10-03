import { ownValue, plainArray, plainRecord, REDACTED } from './diagnostics-data';

const SAFE_ERROR_TYPES: Record<string, true> = {
	AggregateError: true,
	DOMException: true,
	EvalError: true,
	Error: true,
	RangeError: true,
	ReferenceError: true,
	SyntaxError: true,
	TypeError: true,
	URIError: true,
	UnhandledRejection: true,
};
const SAFE_LEVELS: Record<string, true> = {
	fatal: true,
	error: true,
	warning: true,
	log: true,
	info: true,
	debug: true,
};
// Application error classes carry code names, never user data.
const ERROR_CLASS_NAME = /^[A-Z][\w$]{0,63}(Error|Exception)$/u;
// Minified or source function names, e.g. `Object.foo`, `new Bar` or `<anonymous>`.
const FUNCTION_NAME = /^[\w$.<> -]{1,200}$/u;
const UNKNOWN_FUNCTION = '?';

function safeErrorType(value: unknown): string {
	if (typeof value !== 'string') return 'Error';
	if (Object.hasOwn(SAFE_ERROR_TYPES, value)) return value;
	if (ERROR_CLASS_NAME.test(value)) return value;
	return 'Error';
}

function safeFunctionName(value: unknown): string {
	if (typeof value !== 'string') return UNKNOWN_FUNCTION;
	if (!FUNCTION_NAME.test(value)) return UNKNOWN_FUNCTION;
	return value;
}

/**
 * Keeps the absolute script URL of application chunks: PostHog only resolves source maps for
 * `http(s)` frames, and these are public build assets, never document URLs.
 */
function safeFramePath(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	if (value.length > 512) return undefined;
	if (value.includes('?') || value.includes('#')) return undefined;
	let origin = '';
	let path = value;
	if (/^https?:\/\//iu.test(value)) {
		const url = new URL(value);
		origin = url.origin;
		path = url.pathname;
	}
	if (path.split('/').some((segment) => segment === '.' || segment === '..')) return undefined;
	const buildPath = /^\/_app\/immutable\/(assets|chunks|entry|nodes|start)\/[\w./-]+\.js$/u;
	const sourcePath = /^\/src\/(app\/web|lib)\/[\w./-]+\.(js|ts|svelte)$/u;
	if (!buildPath.test(path) && !sourcePath.test(path)) return undefined;
	return `${origin}${path}`;
}

function safePosition(value: unknown, allowZero = false): number | undefined {
	if (typeof value !== 'number') return undefined;
	if (!Number.isInteger(value)) return undefined;
	if (value < 0 || value > 10_000_000) return undefined;
	if (value === 0 && !allowZero) return undefined;
	return value;
}

function sanitizeFrame(value: unknown): Record<string, unknown> | null | undefined {
	if (!plainRecord(value)) return undefined;
	const path = safeFramePath(ownValue(value, 'filename'));
	if (path === undefined) return null;
	const frame: Record<string, unknown> = {
		filename: path,
		abs_path: path,
		function: safeFunctionName(ownValue(value, 'function')),
		platform: 'web:javascript',
		in_app: true,
	};
	const line = safePosition(ownValue(value, 'lineno'));
	const column = safePosition(ownValue(value, 'colno'), true);
	if (line !== undefined) frame['lineno'] = line;
	if (column !== undefined) frame['colno'] = column;
	return frame;
}

function sanitizeFrames(value: unknown): Record<string, unknown>[] | null {
	if (!plainArray(value)) return null;
	const length = ownValue(value, 'length');
	if (typeof length !== 'number') return null;
	if (length > 100) return null;
	const frames: Record<string, unknown>[] = [];
	for (let index = 0; index < length; index += 1) {
		const frame = sanitizeFrame(ownValue(value, String(index)));
		if (frame === undefined) return null;
		if (frame !== null) frames.push(frame);
	}
	return frames;
}

function sanitizeStacktrace(value: unknown): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	if (ownValue(value, 'type') !== 'raw') return null;
	const rawFrames: unknown = ownValue(value, 'frames');
	if (rawFrames === undefined) return null;
	const frames = sanitizeFrames(rawFrames);
	if (frames === null) return null;
	return { type: 'raw', frames };
}

function sanitizeException(value: unknown): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	const exception: Record<string, unknown> = {
		type: safeErrorType(ownValue(value, 'type')),
		value: REDACTED,
	};
	const rawStacktrace: unknown = ownValue(value, 'stacktrace');
	if (rawStacktrace !== undefined) {
		const stacktrace = sanitizeStacktrace(rawStacktrace);
		if (stacktrace === null) return null;
		exception['stacktrace'] = stacktrace;
	}
	return exception;
}

export function sanitizeExceptionList(value: unknown): Record<string, unknown>[] | null {
	if (!plainArray(value)) return null;
	const length = ownValue(value, 'length');
	if (typeof length !== 'number') return null;
	if (length < 1 || length > 10) return null;
	const exceptions: Record<string, unknown>[] = [];
	for (let index = 0; index < length; index += 1) {
		const exception = sanitizeException(ownValue(value, String(index)));
		if (exception === null) return null;
		exceptions.push(exception);
	}
	return exceptions;
}

export function safeExceptionLevel(value: unknown): string {
	if (typeof value !== 'string') return 'error';
	if (!Object.hasOwn(SAFE_LEVELS, value)) return 'error';
	return value;
}
