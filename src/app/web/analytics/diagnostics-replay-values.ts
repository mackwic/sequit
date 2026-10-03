import { safeRoute } from './diagnostics-data';

const CLASS_NAMES: Record<string, true> = {
	absolute: true,
	'canvas-group': true,
	'canvas-lane': true,
	'canvas-lane-label': true,
	'canvas-region': true,
	'canvas-region-label': true,
	contents: true,
	draft: true,
	'group-fold': true,
	'group-header': true,
	junction: true,
	'min-h-full': true,
	'min-w-full': true,
	'node-card': true,
	'pointer-events-none': true,
	positioned: true,
	relative: true,
	selected: true,
	'shrink-0': true,
	'z-10': true,
};
export function number(value: unknown): number | undefined {
	if (typeof value !== 'number') return undefined;
	if (!Number.isFinite(value)) return undefined;
	return value;
}
export function index(value: unknown): number | undefined {
	if (typeof value !== 'number') return undefined;
	if (!Number.isSafeInteger(value) || value < 0) return undefined;
	return value;
}
export function mask(value: string): string {
	return 'x'.repeat(value.length);
}
export function replayUrl(readRoute: () => string | null): string | null {
	const route = safeRoute(readRoute);
	if (route === null) return null;
	if (typeof window === 'undefined') return null;
	return `${window.location.origin}${route}`;
}
export function safeLength(value: string): boolean {
	if (value.length > 128) return false;
	if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%|rem|em|vw|vh)?$/i.test(value)) return true;
	if (!/^(?:calc|min|max)\(/i.test(value)) return false;
	const reduced = value.replace(/(?:calc|min|max)\(/gi, '').replace(/px|rem|em|vw|vh/gi, '');
	return /^[0-9.(),+*/%\s-]+$/.test(reduced);
}
export function safeColor(value: string): boolean {
	return (
		/^#[0-9a-f]{3,4}$|^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ||
		/^(?:transparent|currentcolor|black|white|none)$/i.test(value)
	);
}
function safeStyleValue(property: string, value: string): boolean {
	const key = property.toLowerCase();
	if (/^(?:--content-color|--group-color|fill|stroke|color)$/.test(key)) return safeColor(value);
	if (/^(?:width|height|left|top|right|bottom|stroke-width)$/.test(key)) return safeLength(value);
	if (key === 'transform') return /^scale\(-?(?:\d+(?:\.\d*)?|\.\d+)\)$/.test(value);
	if (key === 'transform-origin')
		return /^(?:top|bottom|left|right|center|0|0 0|[0-9.]+(?:px|%)?(?: [0-9.]+(?:px|%)?)?)$/.test(
			value,
		);
	return false;
}
export function safeClass(value: string): string {
	return value
		.split(/\s+/)
		.filter((name) => CLASS_NAMES[name] === true || /^svelte-[a-zA-Z0-9]+$/.test(name))
		.join(' ');
}
export function staticCss(value: string, tag: string, rel: unknown): boolean {
	if (tag !== 'LINK' || rel !== 'stylesheet') return false;
	let path = value;
	if (typeof window !== 'undefined') {
		try {
			const url = new URL(value, window.location.origin);
			if (url.origin !== window.location.origin) return false;
			if (url.search !== '' || url.hash !== '') return false;
			path = url.pathname;
		} catch {
			return false;
		}
	}
	return /^\/_app\/immutable\/assets\/[A-Za-z0-9_.-]+\.css$/.test(path);
}
export function cleanStyle(value: string): string {
	const kept: string[] = [];
	for (const declaration of value.split(';')) {
		const colon = declaration.indexOf(':');
		if (colon < 1) continue;
		const property = declaration.slice(0, colon).trim();
		const content = declaration.slice(colon + 1).trim();
		if (safeStyleValue(property, content)) kept.push(`${property}:${content}`);
	}
	return kept.join(';');
}
