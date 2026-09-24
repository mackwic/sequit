import * as Y from 'yjs';

import type {
	GridLayoutPresentation,
	LayoutRegionDefinition,
	LogicDocument,
} from '../../core/document/logic-document';
import {
	assertUniqueRelationIds,
	GRID_PERSISTENCE_FORMAT,
	LANE_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_PERSISTENCE_FORMAT,
} from '../../core/document/logic-document';
import { syncSharedFields } from './shared-text';
import {
	createYjsEntityMap,
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_LANE_DOCUMENT_FORMAT,
	YJS_LIVE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YjsCollection,
} from './yjs-document-schema';

function syncCollection<T extends { readonly id: string }>(
	document: Y.Doc,
	name: YjsCollection,
	entities: readonly T[],
	project?: (entity: T) => Readonly<Record<string, unknown>>,
): void {
	const target = document.getMap<Y.Map<unknown>>(name);
	const ids = new Set(entities.map(({ id }) => id));
	for (const id of target.keys()) if (!ids.has(id)) target.delete(id);
	for (const entity of entities) {
		const values: Record<string, unknown> = {
			...(project?.(entity) ??
				Object.fromEntries(
					Object.entries(entity).filter(([key]) => key !== 'id' && key !== 'kind'),
				)),
		};
		if (name === YjsCollection.Nodes) values['description'] ??= '';
		let map = target.get(entity.id);
		if (map === undefined) {
			map = createYjsEntityMap({});
			target.set(entity.id, map);
		}
		syncSharedFields(map, values);
	}
}

function syncRegionLanes(
	lanes: Y.Map<Y.Map<unknown>>,
	definitions: readonly NonNullable<LayoutRegionDefinition['lanePresentation']>['lanes'][number][],
): void {
	const laneIds = new Set(definitions.map(({ id }) => id));
	for (const laneId of lanes.keys()) if (!laneIds.has(laneId)) lanes.delete(laneId);
	for (const lane of definitions) {
		let entity = lanes.get(lane.id);
		if (!(entity instanceof Y.Map)) {
			entity = createYjsEntityMap({});
			lanes.set(lane.id, entity);
		}
		syncSharedFields(entity, { label: lane.label, layoutOrder: lane.layoutOrder });
	}
}

function syncRegionLaneCollection(
	document: Y.Doc,
	regions: readonly LayoutRegionDefinition[],
): void {
	const collection = document.getMap<Y.Map<Y.Map<unknown>>>(YjsCollection.RegionLanes);
	const active = new Set(
		regions.filter(({ lanePresentation }) => lanePresentation !== undefined).map(({ id }) => id),
	);
	for (const regionId of collection.keys()) if (!active.has(regionId)) collection.delete(regionId);
	for (const region of regions) {
		const presentation = region.lanePresentation;
		if (presentation === undefined) continue;
		let lanes = collection.get(region.id);
		if (!(lanes instanceof Y.Map)) {
			lanes = new Y.Map<Y.Map<unknown>>();
			collection.set(region.id, lanes);
		}
		syncRegionLanes(lanes, presentation.lanes);
	}
}

function syncGridCells(cells: Y.Map<unknown>, grid: GridLayoutPresentation): void {
	const active = new Set(grid.cells.map(({ regionId }) => regionId));
	for (const childId of cells.keys()) if (!active.has(childId)) cells.delete(childId);
	for (const { regionId, row, column } of grid.cells) {
		const existing = cells.get(regionId);
		let cell: Y.Map<unknown>;
		if (existing instanceof Y.Map) cell = existing;
		else {
			cell = createYjsEntityMap({});
			cells.set(regionId, cell);
		}
		syncSharedFields(cell, { row, column });
	}
}

function syncRegionGridEntry(entity: Y.Map<unknown>, grid: GridLayoutPresentation): void {
	const existing = entity.get('cells');
	let cells: Y.Map<unknown>;
	if (existing instanceof Y.Map) cells = existing;
	else {
		cells = new Y.Map<unknown>();
		entity.set('cells', cells);
	}
	syncGridCells(cells, grid);
	syncSharedFields(entity, {
		minimumColumnWidths: [...grid.minimumColumnWidths],
		minimumRowHeights: [...grid.minimumRowHeights],
		cells,
	});
}

function syncRegionGridCollection(
	document: Y.Doc,
	regions: readonly LayoutRegionDefinition[],
): void {
	const collection = document.getMap<Y.Map<unknown>>(YjsCollection.RegionGrids);
	const active = new Set(regions.filter(({ grid }) => grid !== undefined).map(({ id }) => id));
	for (const regionId of collection.keys()) if (!active.has(regionId)) collection.delete(regionId);
	for (const region of regions) {
		const grid = region.grid;
		if (grid === undefined) continue;
		let entity = collection.get(region.id);
		if (!(entity instanceof Y.Map)) {
			entity = createYjsEntityMap({});
			collection.set(region.id, entity);
		}
		syncRegionGridEntry(entity, grid);
	}
}

/** Reconcile existing entities and texts in place; never reconstruct a live document. */
export function reconcileSharedDocument(
	document: Y.Doc,
	next: LogicDocument,
	origin: unknown,
): void {
	assertUniqueRelationIds(next.relations);
	document.transact(() => {
		const meta = document.getMap(YjsCollection.Meta);
		const presentation = next.presentation;
		const regionPresentation = next.regionPresentation;
		let liveFormat: number = YJS_LIVE_DOCUMENT_FORMAT;
		if (next.persistenceFormat === LANE_PERSISTENCE_FORMAT) liveFormat = YJS_LANE_DOCUMENT_FORMAT;
		if (next.persistenceFormat === REGION_PERSISTENCE_FORMAT)
			liveFormat = YJS_REGION_DOCUMENT_FORMAT;
		if (next.persistenceFormat === GRID_PERSISTENCE_FORMAT) liveFormat = YJS_GRID_DOCUMENT_FORMAT;
		if (next.persistenceFormat === REGION_LANE_PERSISTENCE_FORMAT)
			liveFormat = YJS_REGION_LANE_DOCUMENT_FORMAT;
		if (next.persistenceFormat === REGION_COMPOSITION_PERSISTENCE_FORMAT)
			liveFormat = YJS_REGION_COMPOSITION_DOCUMENT_FORMAT;
		const metaValues: Record<string, unknown> = {
			...meta.toJSON(),
			yjsLiveDocumentFormat: liveFormat,
			persistenceFormat: next.persistenceFormat,
			id: next.id,
			title: next.title,
			layoutDirection: next.layout.direction,
			layoutBias: next.layout.bias,
		};
		if (presentation === undefined) {
			delete metaValues['layoutPresentationSchema'];
			delete metaValues['rootLayoutPolicy'];
			delete metaValues['laneOrientation'];
			delete metaValues['laneGrowth'];
		} else {
			metaValues['layoutPresentationSchema'] = presentation.schemaVersion;
			metaValues['rootLayoutPolicy'] = presentation.policy;
			metaValues['laneOrientation'] = presentation.laneOrientation;
			metaValues['laneGrowth'] = presentation.growth;
		}
		if (regionPresentation === undefined) delete metaValues['regionPresentationSchema'];
		else metaValues['regionPresentationSchema'] = regionPresentation.schemaVersion;
		const grid = regionPresentation?.grid;
		if (grid === undefined) {
			delete metaValues['gridMinimumColumnWidths'];
			delete metaValues['gridMinimumRowHeights'];
		} else {
			metaValues['gridMinimumColumnWidths'] = [...grid.minimumColumnWidths];
			metaValues['gridMinimumRowHeights'] = [...grid.minimumRowHeights];
		}
		syncSharedFields(meta, metaValues);
		syncCollection(document, YjsCollection.Lanes, presentation?.lanes ?? []);
		syncCollection(
			document,
			YjsCollection.Regions,
			regionPresentation?.regions ?? [],
			({ parentId, layoutOrder, policy, lanePresentation }) => {
				const values: Record<string, unknown> = { layoutOrder, policy };
				if (parentId !== undefined) values['parentId'] = parentId;
				if (lanePresentation !== undefined) {
					values['laneOrientation'] = lanePresentation.laneOrientation;
					values['laneGrowth'] = lanePresentation.growth;
				}
				return values;
			},
		);
		syncRegionLaneCollection(document, regionPresentation?.regions ?? []);
		syncRegionGridCollection(document, regionPresentation?.regions ?? []);
		syncCollection(
			document,
			YjsCollection.GridCells,
			grid?.cells.map(({ regionId, row, column }) => ({ id: regionId, row, column })) ?? [],
		);
		syncCollection(document, YjsCollection.Natures, next.natures);
		syncCollection(document, YjsCollection.Groups, next.groups);
		syncCollection(document, YjsCollection.Nodes, next.nodes);
		syncCollection(document, YjsCollection.Junctions, next.junctions);
		syncCollection(document, YjsCollection.Relations, next.relations);
	}, origin);
}
