import * as Y from 'yjs';

import {
	assertUniqueRelationIds,
	contentStyleFields,
	GRID_PERSISTENCE_FORMAT,
	LANE_PERSISTENCE_FORMAT,
	type LayoutRegionDefinition,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_PERSISTENCE_FORMAT,
	REGION_POLICY_PERSISTENCE_FORMAT,
} from '../../core/document/logic-document';
import { createGraph } from '../../core/graph/create-graph';
import { sharedFieldValue } from './shared-text';
import {
	readStructuralLogicDocument,
	YjsLiveDocumentDiagnosticCode,
	type YjsLiveDocumentResult,
} from './yjs-document-reader';
import {
	createYjsEntityMap,
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_LANE_DOCUMENT_FORMAT,
	YJS_LIVE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YJS_REGION_POLICY_DOCUMENT_FORMAT,
	YjsCollection,
} from './yjs-document-schema';

export {
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_LANE_DOCUMENT_FORMAT,
	YJS_LIVE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YJS_REGION_POLICY_DOCUMENT_FORMAT,
};

export type { YjsLiveDocumentResult };

function replaceMapContents(
	target: Y.Map<unknown>,
	values: Readonly<Record<string, unknown>>,
): void {
	target.clear();
	for (const [key, value] of Object.entries(values)) target.set(key, sharedFieldValue(key, value));
}

function replaceEntityCollection<T extends { readonly id: string }>(
	target: Y.Map<Y.Map<unknown>>,
	entities: readonly T[],
	project: (entity: T) => Readonly<Record<string, unknown>>,
): void {
	target.clear();
	for (const entity of entities)
		target.set(
			entity.id,
			createYjsEntityMap(
				Object.fromEntries(
					Object.entries(project(entity)).map(([key, value]) => [
						key,
						sharedFieldValue(key, value),
					]),
				),
			),
		);
}

function replaceRegionLaneCollection(
	target: Y.Map<Y.Map<Y.Map<unknown>>>,
	regions: readonly LayoutRegionDefinition[],
): void {
	target.clear();
	for (const region of regions) {
		const presentation = region.lanePresentation;
		if (presentation === undefined) continue;
		const lanes = new Y.Map<Y.Map<unknown>>();
		for (const lane of presentation.lanes)
			lanes.set(
				lane.id,
				createYjsEntityMap({ label: new Y.Text(lane.label), layoutOrder: lane.layoutOrder }),
			);
		target.set(region.id, lanes);
	}
}

function replaceRegionGridCollection(
	target: Y.Map<Y.Map<unknown>>,
	regions: readonly LayoutRegionDefinition[],
): void {
	target.clear();
	for (const region of regions) {
		const grid = region.grid;
		if (grid === undefined) continue;
		const cells = new Y.Map<Y.Map<unknown>>();
		for (const { regionId, row, column } of grid.cells)
			cells.set(regionId, createYjsEntityMap({ row, column }));
		target.set(
			region.id,
			createYjsEntityMap({
				minimumColumnWidths: [...grid.minimumColumnWidths],
				minimumRowHeights: [...grid.minimumRowHeights],
				cells,
			}),
		);
	}
}

function assignmentFields(
	groupId: string | undefined,
	laneId: string | undefined,
	regionId: string | undefined,
): Record<string, string> {
	const fields: Record<string, string> = {};
	if (groupId !== undefined) fields['groupId'] = groupId;
	if (laneId !== undefined) fields['laneId'] = laneId;
	if (regionId !== undefined) fields['regionId'] = regionId;
	return fields;
}

const IMPORT_ORIGIN = Symbol('sequit import');

export function importLogicDocument(
	ydoc: Y.Doc,
	document: LogicDocument,
	origin: unknown = IMPORT_ORIGIN,
): void {
	assertUniqueRelationIds(document.relations);
	const presentation = document.presentation;
	const regionPresentation = document.regionPresentation;
	const explicitLanes =
		document.persistenceFormat === LANE_PERSISTENCE_FORMAT || presentation !== undefined;
	let liveFormat: number = YJS_LIVE_DOCUMENT_FORMAT;
	if (explicitLanes) liveFormat = YJS_LANE_DOCUMENT_FORMAT;
	if (document.persistenceFormat === REGION_PERSISTENCE_FORMAT)
		liveFormat = YJS_REGION_DOCUMENT_FORMAT;
	if (document.persistenceFormat === GRID_PERSISTENCE_FORMAT) liveFormat = YJS_GRID_DOCUMENT_FORMAT;
	if (document.persistenceFormat === REGION_LANE_PERSISTENCE_FORMAT)
		liveFormat = YJS_REGION_LANE_DOCUMENT_FORMAT;
	if (document.persistenceFormat === REGION_COMPOSITION_PERSISTENCE_FORMAT)
		liveFormat = YJS_REGION_COMPOSITION_DOCUMENT_FORMAT;
	if (document.persistenceFormat === REGION_POLICY_PERSISTENCE_FORMAT)
		liveFormat = YJS_REGION_POLICY_DOCUMENT_FORMAT;
	const presentationFields: Record<string, unknown> = {};
	if (presentation !== undefined) {
		presentationFields['layoutPresentationSchema'] = presentation.schemaVersion;
		presentationFields['rootLayoutPolicy'] = presentation.policy;
		presentationFields['laneOrientation'] = presentation.laneOrientation;
		presentationFields['laneGrowth'] = presentation.growth;
	}
	if (regionPresentation !== undefined)
		presentationFields['regionPresentationSchema'] = regionPresentation.schemaVersion;
	const grid = regionPresentation?.grid;
	if (grid !== undefined) {
		presentationFields['gridMinimumColumnWidths'] = [...grid.minimumColumnWidths];
		presentationFields['gridMinimumRowHeights'] = [...grid.minimumRowHeights];
	}
	ydoc.transact(() => {
		replaceMapContents(ydoc.getMap(YjsCollection.Meta), {
			yjsLiveDocumentFormat: liveFormat,
			persistenceFormat: document.persistenceFormat,
			id: document.id,
			title: document.title,
			layoutDirection: document.layout.direction,
			layoutBias: document.layout.bias,
			...presentationFields,
		});
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Lanes),
			presentation?.lanes ?? [],
			({ label, layoutOrder }) => ({ label, layoutOrder }),
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Regions),
			regionPresentation?.regions ?? [],
			({ parentId, layoutOrder, policy, lanePresentation }) => {
				const region: Record<string, unknown> = { layoutOrder, policy };
				if (parentId !== undefined) region['parentId'] = parentId;
				if (lanePresentation !== undefined) {
					region['laneOrientation'] = lanePresentation.laneOrientation;
					region['laneGrowth'] = lanePresentation.growth;
				}
				return region;
			},
		);
		replaceRegionLaneCollection(
			ydoc.getMap(YjsCollection.RegionLanes),
			regionPresentation?.regions ?? [],
		);
		replaceRegionGridCollection(
			ydoc.getMap(YjsCollection.RegionGrids),
			regionPresentation?.regions ?? [],
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.GridCells),
			(grid?.cells ?? []).map((cell) => ({ ...cell, id: cell.regionId })),
			({ row, column }) => ({ row, column }),
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Natures),
			document.natures,
			({ label, color, icon }) => ({
				label,
				...contentStyleFields(color, icon),
			}),
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Groups),
			document.groups,
			({ label, color, groupId, laneId, regionId, layoutOrder, state }) => {
				const values: Record<string, unknown> = {
					label,
					...contentStyleFields(color, undefined),
					layoutOrder,
				};
				if (state !== undefined) values['state'] = state;
				return Object.assign(values, assignmentFields(groupId, laneId, regionId));
			},
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Nodes),
			document.nodes,
			({
				natureId,
				groupId,
				laneId,
				regionId,
				markdown,
				description,
				layoutOrder,
				color,
				icon,
			}) => {
				const text = new Y.Text();
				text.insert(0, markdown);
				const values: Record<string, unknown> = {
					natureId,
					layoutOrder,
					markdown: text,
					description: new Y.Text(description ?? ''),
					...contentStyleFields(color, icon),
				};
				return Object.assign(values, assignmentFields(groupId, laneId, regionId));
			},
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Junctions),
			document.junctions,
			({ operator, groupId, laneId, regionId, layoutOrder }) => {
				const values: Record<string, unknown> = { operator, layoutOrder };
				return Object.assign(values, assignmentFields(groupId, laneId, regionId));
			},
		);
		replaceEntityCollection(
			ydoc.getMap(YjsCollection.Relations),
			document.relations,
			({ from, to }) => ({
				from,
				to,
			}),
		);
	}, origin);
}

export function validateLogicDocumentGraph(
	document: LogicDocument,
): ReturnType<typeof createGraph> {
	return createGraph(document);
}

export function readLogicDocument(ydoc: Y.Doc): YjsLiveDocumentResult<LogicDocument> {
	const document = readStructuralLogicDocument(ydoc);
	if (!document.ok) return document;
	const graph = createGraph(document.value);
	if (graph.ok) return { ok: true, value: graph.value.document };
	return {
		ok: false,
		diagnostics: graph.diagnostics.map(({ message, path }) => ({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message,
			path,
		})),
	};
}
