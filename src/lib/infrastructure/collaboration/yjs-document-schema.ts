import * as Y from 'yjs';

export const YJS_LIVE_DOCUMENT_FORMAT = 3 as const;

export enum YjsCollection {
	Meta = 'sequit.meta',
	Natures = 'sequit.natures',
	Groups = 'sequit.groups',
	Nodes = 'sequit.nodes',
	Junctions = 'sequit.junctions',
	Relations = 'sequit.relations',
}

export function createYjsEntityMap(values: Readonly<Record<string, unknown>>): Y.Map<unknown> {
	const result = new Y.Map<unknown>();
	for (const [key, value] of Object.entries(values)) result.set(key, value);
	return result;
}
