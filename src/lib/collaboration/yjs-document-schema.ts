import * as Y from 'yjs';

export const YJS_COLLECTIONS = {
	meta: 'sequit.meta',
	natures: 'sequit.natures',
	groups: 'sequit.groups',
	nodes: 'sequit.nodes',
	junctions: 'sequit.junctions',
	relations: 'sequit.relations',
} as const;

export function createYjsEntityMap(values: Readonly<Record<string, unknown>>): Y.Map<unknown> {
	const result = new Y.Map<unknown>();
	for (const [key, value] of Object.entries(values)) result.set(key, value);
	return result;
}
