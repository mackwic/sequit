import * as Y from 'yjs';

export const YJS_LIVE_DOCUMENT_FORMAT = 3 as const;
export const YJS_LANE_DOCUMENT_FORMAT = 4 as const;
export const YJS_REGION_DOCUMENT_FORMAT = 5 as const;
export const YJS_GRID_DOCUMENT_FORMAT = 6 as const;
export const YJS_REGION_LANE_DOCUMENT_FORMAT = 7 as const;
export const YJS_REGION_COMPOSITION_DOCUMENT_FORMAT = 8 as const;

export enum YjsCollection {
	Meta = 'sequit.meta',
	Natures = 'sequit.natures',
	Groups = 'sequit.groups',
	Nodes = 'sequit.nodes',
	Junctions = 'sequit.junctions',
	Relations = 'sequit.relations',
	Lanes = 'sequit.lanes',
	Regions = 'sequit.regions',
	RegionLanes = 'sequit.regionLanes',
	RegionGrids = 'sequit.regionGrids',
	GridCells = 'sequit.gridCells',
}

export function createYjsEntityMap(values: Readonly<Record<string, unknown>>): Y.Map<unknown> {
	const result = new Y.Map<unknown>();
	for (const [key, value] of Object.entries(values)) result.set(key, value);
	return result;
}
