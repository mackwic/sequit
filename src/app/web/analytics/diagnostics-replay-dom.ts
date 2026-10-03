import { plainArray, plainRecord } from './diagnostics-data';
import { attributes } from './diagnostics-replay-attributes';
import { index, mask, number } from './diagnostics-replay-values';

const BLOCKED: Record<string, true> = {
	AUDIO: true,
	CANVAS: true,
	EMBED: true,
	IFRAME: true,
	IMAGE: true,
	IMG: true,
	INPUT: true,
	SCRIPT: true,
	META: true,
	OBJECT: true,
	OPTION: true,
	PICTURE: true,
	SELECT: true,
	TEXTAREA: true,
	VIDEO: true,
};
const SAFE_TAG =
	/^(?:html|head|body|link|style|title|base|div|span|p|a|button|form|label|section|main|aside|nav|header|footer|article|h[1-6]|ul|ol|li|pre|code|br|hr|table|thead|tbody|tfoot|tr|th|td|col|colgroup|details|summary|small|strong|em|i|b|u|s|kbd|figure|figcaption|dialog|fieldset|legend|svg|path|g|line|rect|circle|ellipse|polyline|polygon|text|tspan|defs|clipPath|marker|foreignObject|use)$/;
function children(value: unknown, depth: number): unknown[] {
	if (!plainArray(value)) return [];
	return value.map((item) => node(item, depth + 1)).filter((item) => item !== null);
}
function node(value: unknown, depth: number): unknown {
	if (!plainRecord(value) || depth > 100) return null;
	const id = index(value['id']);
	if (id === undefined) return null;
	if (value['type'] === 2) return element(value, id, depth);
	if (value['type'] === 0 && plainArray(value['childNodes'])) return documentNode(value, id, depth);
	if (value['type'] === 1) return { type: 1, id, name: 'html', publicId: '', systemId: '' };
	if (value['type'] === 3) {
		if (typeof value['textContent'] !== 'string') return null;
		return { type: 3, id, textContent: mask(value['textContent']) };
	}
	if (value['type'] === 4 || value['type'] === 5)
		return { type: value['type'], id, textContent: '' };
	return null;
}
function element(value: Record<string, unknown>, id: number, depth: number): unknown {
	if (typeof value['tagName'] !== 'string') return null;
	if (!plainArray(value['childNodes'])) return null;
	const tag = value['tagName'].toUpperCase();
	if (!SAFE_TAG.test(value['tagName'])) return null;
	if (BLOCKED[tag] === true) return null;
	const output = {
		type: 2,
		id,
		tagName: value['tagName'],
		attributes: attributes(value['attributes'], tag),
		childNodes: children(value['childNodes'], depth),
	};
	if (value['isSVG'] === true) return { ...output, isSVG: true };
	return output;
}
function documentNode(value: Record<string, unknown>, id: number, depth: number): unknown {
	const output: Record<string, unknown> = {
		type: 0,
		id,
		childNodes: children(value['childNodes'], depth),
	};
	if (value['compatMode'] === 'CSS1Compat' || value['compatMode'] === 'BackCompat')
		output['compatMode'] = value['compatMode'];
	return output;
}
export function fullSnapshot(value: unknown): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	if (!plainRecord(value['node']) || !plainRecord(value['initialOffset'])) return null;
	const safeNode = node(value['node'], 0);
	const top = number(value['initialOffset']['top']);
	const left = number(value['initialOffset']['left']);
	if (safeNode === null) return null;
	if (top === undefined || left === undefined) return null;
	return { node: safeNode, initialOffset: { top, left } };
}
function mutationText(value: unknown): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	if (typeof value['value'] !== 'string') return null;
	const id = index(value['id']);
	if (id === undefined) return null;
	return { id, value: mask(value['value']) };
}
function mutationAttributes(value: unknown): Record<string, unknown> | null {
	if (!plainRecord(value) || !plainRecord(value['attributes'])) return null;
	const id = index(value['id']);
	if (id === undefined) return null;
	return { id, attributes: attributes(value['attributes'], '') };
}
function mutationAdd(value: unknown): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	const parentId = index(value['parentId']);
	const safeNode = node(value['node'], 0);
	if (parentId === undefined || safeNode === null) return null;
	const output: Record<string, unknown> = { parentId, node: safeNode };
	output['previousId'] = optionalId(value['previousId']);
	output['nextId'] = optionalId(value['nextId']);
	if (output['previousId'] === undefined || output['nextId'] === undefined) return null;
	return output;
}
function optionalId(value: unknown): number | null | undefined {
	if (value === null || value === undefined) return null;
	return index(value);
}
function mutationRemove(value: unknown): Record<string, unknown> | null {
	if (!plainRecord(value)) return null;
	const id = index(value['id']);
	const parentId = index(value['parentId']);
	if (id === undefined || parentId === undefined) return null;
	return { id, parentId };
}
export function mutation(value: Record<string, unknown>): Record<string, unknown> | null {
	if (!plainArray(value['texts']) || !plainArray(value['attributes'])) return null;
	if (!plainArray(value['removes']) || !plainArray(value['adds'])) return null;
	return {
		source: 0,
		texts: value['texts'].map(mutationText).filter(plainRecord),
		attributes: value['attributes'].map(mutationAttributes).filter(plainRecord),
		removes: value['removes'].map(mutationRemove).filter(plainRecord),
		adds: value['adds'].map(mutationAdd).filter(plainRecord),
	};
}
