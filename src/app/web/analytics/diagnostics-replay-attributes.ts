import { plainRecord } from './diagnostics-data';
import { safeClass } from './diagnostics-replay-classes';
import {
	cleanStyle,
	mask,
	number,
	safeColor,
	safeLength,
	staticCss,
} from './diagnostics-replay-values';

const MARKERS: Record<string, true> = {
	'data-canvas-sizing-wrapper': true,
	'data-graph-stage': true,
	'data-group-header': true,
	'data-node-header': true,
};
const SVG_PATH = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]+$/;
const SVG_NUMBERS = /^[0-9eE.,+\-\s]+$/;
const SAFE_ATTR =
	/^(?:class|style|href|rel|role|type|tabindex|aria-(?:hidden|pressed|expanded|label)|alt|title|data-(?:canvas-sizing-wrapper|graph-stage|group-header|node-header|stage-(?:width|height)|print-orientation)|width|height|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|viewbox|d|points|fill|stroke|stroke-width|stroke-dasharray|stroke-linecap|stroke-linejoin|fill-rule|opacity|fill-opacity|stroke-opacity|vector-effect|xmlns)$/;
function safeSvg(key: string, value: unknown): unknown {
	if (key === 'fill' || key === 'stroke') return svgColor(value);
	if (key === 'd') return svgPath(value);
	if (/^(?:points|viewbox|stroke-dasharray)$/.test(key)) return svgNumbers(value);
	if (typeof value !== 'string') return geometry(key, value);
	if (key === 'stroke-linecap' && /^(?:butt|round|square)$/.test(value)) return value;
	if (key === 'stroke-linejoin' && /^(?:miter|round|bevel)$/.test(value)) return value;
	if (key === 'fill-rule' && /^(?:evenodd|nonzero)$/.test(value)) return value;
	if (key === 'vector-effect' && value === 'non-scaling-stroke') return value;
	if (key === 'xmlns' && value === 'http://www.w3.org/2000/svg') return value;
	return geometry(key, value);
}
function svgColor(value: unknown): unknown {
	if (typeof value === 'string' && safeColor(value)) return value;
	return undefined;
}
function svgPath(value: unknown): unknown {
	if (typeof value !== 'string') return undefined;
	if (value.length <= 4096 && SVG_PATH.test(value)) return value;
	return undefined;
}
function svgNumbers(value: unknown): unknown {
	if (typeof value === 'string' && SVG_NUMBERS.test(value)) return value;
	return undefined;
}
function geometry(key: string, value: unknown): unknown {
	if (
		/^(?:width|height|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|stroke-width|data-stage-width|data-stage-height)$/.test(
			key,
		)
	) {
		if (typeof value === 'string' && safeLength(value)) return value;
		return number(value);
	}
	if (!/^(?:opacity|fill-opacity|stroke-opacity)$/.test(key)) return undefined;
	if (typeof value === 'string' && /^(?:0|1|0?\.\d+)$/.test(value)) return value;
	return undefined;
}
function attributeValue(key: string, value: unknown, tag: string, rel: unknown): unknown {
	if (MARKERS[key] === true) {
		if (value === true || value === '') return value;
		return undefined;
	}
	if (typeof value !== 'string') return safeSvg(key, value);
	if (key === 'class') return safeClass(value);
	if (key === 'style') return cleanStyle(value);
	if (key === 'href') {
		if (staticCss(value, tag, rel)) return value;
		return undefined;
	}
	const standard = standardAttribute(key, value);
	if (standard !== undefined) return standard;
	return safeSvg(key, value);
}
function standardAttribute(key: string, value: string): string | undefined {
	switch (key) {
		case 'rel':
			if (value === 'stylesheet') return value;
			break;
		case 'role':
			if (value === 'group' || value === 'img') return value;
			break;
		case 'type':
			if (value === 'button') return value;
			break;
		case 'tabindex':
			if (/^-?\d{1,2}$/.test(value)) return value;
			break;
		case 'data-print-orientation':
			if (value === 'portrait' || value === 'landscape') return value;
			break;
		default:
			if (key.startsWith('aria-') && /^(?:true|false)$/.test(value)) return value;
	}
	return undefined;
}
export function attributes(value: unknown, tag: string): Record<string, unknown> {
	if (!plainRecord(value)) return {};
	const output: Record<string, unknown> = {};
	for (const [name, raw] of Object.entries(value)) {
		const key = name.toLowerCase();
		if (!SAFE_ATTR.test(key)) continue;
		if (isMaskedAttribute(key, raw)) output[key] = mask(raw);
		else {
			const safe = attributeValue(key, raw, tag, value['rel']);
			if (safe !== undefined) output[key] = safe;
		}
	}
	return output;
}
function isMaskedAttribute(key: string, value: unknown): value is string {
	if (typeof value !== 'string') return false;
	return /^(?:title|aria-label|alt)$/.test(key);
}
export function rrwebAttribute(name: string, value: string, element?: Element): string {
	if (element === undefined) return '';
	const key = name.toLowerCase();
	if (isMaskedAttribute(key, value)) return mask(value);
	if (!SAFE_ATTR.test(key)) return '';
	const safe = attributeValue(key, value, element.tagName, element.getAttribute('rel'));
	if (typeof safe === 'string') return safe;
	return '';
}
