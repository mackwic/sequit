import * as Y from 'yjs';

import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	GRID_REGION_PRESENTATION_SCHEMA,
	LaneGrowth,
	LaneOrientation,
	type LayoutLane,
	LayoutPolicy,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_PRESENTATION_SCHEMA,
	type RegionLanePresentation,
	type RegionLayoutPresentation,
} from '../../core/document/logic-document';
import {
	readGridPresentation,
	readRegionGridPresentation,
	rejectGridPresentation,
} from './yjs-document-grid';
import { readCollection } from './yjs-document-presentation';
import { type ReadContext, YjsLiveDocumentDiagnosticCode } from './yjs-document-result';
import {
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YjsCollection,
} from './yjs-document-schema';
import {
	readOptionalString,
	readRequiredLayoutOrder,
	readString,
	readText,
} from './yjs-field-readers';

const policyByValue: Readonly<Record<string, LayoutPolicy>> = {
	[LayoutPolicy.Layered]: LayoutPolicy.Layered,
};
const growthByValue: Readonly<Record<string, LaneGrowth>> = {
	[LaneGrowth.Auto]: LaneGrowth.Auto,
};
const REGION_YJS_FORMATS = new Set<number>([
	YJS_REGION_DOCUMENT_FORMAT,
	YJS_GRID_DOCUMENT_FORMAT,
	YJS_REGION_LANE_DOCUMENT_FORMAT,
	YJS_REGION_COMPOSITION_DOCUMENT_FORMAT,
]);

interface RegionReadOptions {
	readonly version: number;
	readonly regionLanes: Y.Map<unknown>;
	readonly regionGrids: Y.Map<unknown>;
	readonly context: ReadContext;
}

interface MaterializeRegionOptions {
	readonly version: number;
	readonly schema: unknown;
	readonly regions: RegionLayoutPresentation['regions'];
	readonly context: ReadContext;
}

function invalid(context: ReadContext, message: string, path: readonly string[]): void {
	context.diagnostics.push({ code: YjsLiveDocumentDiagnosticCode.Invalid, message, path });
}

function readRegionLanes(
	value: unknown,
	regionId: string,
	context: ReadContext,
): readonly LayoutLane[] | undefined {
	const path = ['regionPresentation', 'regions', regionId, 'lanePresentation', 'lanes'];
	if (!(value instanceof Y.Map)) {
		invalid(context, 'Region lanes must be a Y.Map', path);
		return undefined;
	}
	const lanes: LayoutLane[] = [];
	for (const laneId of [...value.keys()].sort(compareCanonicalStrings)) {
		const lane: unknown = value.get(laneId);
		const lanePath = [...path, laneId];
		if (!(lane instanceof Y.Map)) {
			invalid(context, 'Region lane must be a Y.Map', lanePath);
			continue;
		}
		const label = readText(lane.get('label'), [...lanePath, 'label'], context);
		const layoutOrder = readRequiredLayoutOrder(
			lane.get('layoutOrder'),
			[...lanePath, 'layoutOrder'],
			context,
		);
		if (label !== undefined && layoutOrder !== undefined)
			lanes.push({ id: laneId, label, layoutOrder });
	}
	return lanes;
}

function readLanePresentation(
	entity: Y.Map<unknown>,
	regionLanes: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): RegionLanePresentation | undefined {
	const path = ['regionPresentation', 'regions', id, 'lanePresentation'];
	const hasOrientation = entity.has('laneOrientation');
	const hasGrowth = entity.has('laneGrowth');
	const lanesValue = regionLanes.get(id);
	const hasLocalLanes = hasOrientation || hasGrowth || lanesValue !== undefined;
	if (!hasLocalLanes) return undefined;
	const orientationValue = readString(
		entity.get('laneOrientation'),
		[...path, 'laneOrientation'],
		context,
	);
	let orientation: LaneOrientation | undefined;
	if (orientationValue === LaneOrientation.Parallel) orientation = LaneOrientation.Parallel;
	if (orientationValue === LaneOrientation.Transverse) orientation = LaneOrientation.Transverse;
	if (orientationValue !== undefined && orientation === undefined)
		invalid(context, `Unsupported region lane orientation: ${orientationValue}`, [
			...path,
			'laneOrientation',
		]);
	const growth = readString(entity.get('laneGrowth'), [...path, 'growth'], context);
	let mappedGrowth: LaneGrowth | undefined;
	if (growth !== undefined) mappedGrowth = growthByValue[growth];
	if (growth !== undefined && mappedGrowth === undefined)
		invalid(context, `Unsupported region lane growth policy: ${growth}`, [...path, 'growth']);
	const lanes = readRegionLanes(lanesValue, id, context);
	if (orientation === undefined) return undefined;
	if (mappedGrowth === undefined) return undefined;
	if (lanes === undefined) return undefined;
	return { laneOrientation: orientation, growth: LaneGrowth.Auto, lanes };
}

function regionLaneFields(
	entity: Y.Map<unknown>,
	id: string,
	options: RegionReadOptions,
): { readonly lanePresentation?: RegionLanePresentation } {
	if (
		options.version !== YJS_REGION_LANE_DOCUMENT_FORMAT &&
		options.version !== YJS_REGION_COMPOSITION_DOCUMENT_FORMAT
	) {
		if (entity.has('laneOrientation') || entity.has('laneGrowth'))
			invalid(options.context, 'This shared format cannot persist region lanes', [
				'regionPresentation',
				'regions',
				id,
				'lanePresentation',
			]);
		return {};
	}
	const lanePresentation = readLanePresentation(entity, options.regionLanes, id, options.context);
	if (lanePresentation === undefined) return {};
	return { lanePresentation };
}

function regionGridFields(
	id: string,
	options: RegionReadOptions,
): { readonly grid?: NonNullable<RegionLayoutPresentation['regions'][number]['grid']> } {
	if (options.version !== YJS_REGION_COMPOSITION_DOCUMENT_FORMAT) return {};
	if (!options.regionGrids.has(id)) return {};
	const grid = readRegionGridPresentation(options.regionGrids.get(id), id, options.context);
	if (grid === undefined) return {};
	return { grid };
}

function readRegion(
	entity: Y.Map<unknown>,
	id: string,
	options: RegionReadOptions,
): RegionLayoutPresentation['regions'][number] | undefined {
	const { context } = options;
	const path = ['regionPresentation', 'regions', id];
	const parentId = readOptionalString(entity.get('parentId'), [...path, 'parentId'], context);
	const layoutOrder = readRequiredLayoutOrder(
		entity.get('layoutOrder'),
		[...path, 'layoutOrder'],
		context,
	);
	const policy = readString(entity.get('policy'), [...path, 'policy'], context);
	let mappedPolicy: LayoutPolicy | undefined;
	if (policy !== undefined) mappedPolicy = policyByValue[policy];
	if (policy !== undefined && mappedPolicy === undefined)
		invalid(context, `Unsupported region layout policy: ${policy}`, [...path, 'policy']);
	const laneFields = regionLaneFields(entity, id, options);
	const gridFields = regionGridFields(id, options);
	if (layoutOrder === undefined || mappedPolicy === undefined) return undefined;
	const parentFields: { parentId?: string } = {};
	if (parentId !== undefined) parentFields.parentId = parentId;
	return {
		id,
		...parentFields,
		layoutOrder,
		policy: LayoutPolicy.Layered,
		...laneFields,
		...gridFields,
	};
}

function validateRegionLaneEntries(
	regionLanes: Y.Map<unknown>,
	regionIds: ReadonlySet<string>,
	version: number,
	context: ReadContext,
): void {
	for (const id of [...regionLanes.keys()].sort(compareCanonicalStrings)) {
		const path = ['regionPresentation', 'regions', id, 'lanePresentation'];
		if (
			version === YJS_REGION_LANE_DOCUMENT_FORMAT ||
			version === YJS_REGION_COMPOSITION_DOCUMENT_FORMAT
		) {
			if (!regionIds.has(id))
				invalid(context, 'Region lanes must belong to an existing region', path);
			continue;
		}
		invalid(context, 'This shared format cannot persist region lanes', path);
	}
}

function validateRegionGridEntries(
	regionGrids: Y.Map<unknown>,
	regionIds: ReadonlySet<string>,
	version: number,
	context: ReadContext,
): void {
	for (const id of [...regionGrids.keys()].sort(compareCanonicalStrings)) {
		const path = ['regionPresentation', 'regions', id, 'grid'];
		if (version === YJS_REGION_COMPOSITION_DOCUMENT_FORMAT) {
			if (!regionIds.has(id))
				invalid(context, 'Region grid must belong to an existing region', path);
			continue;
		}
		invalid(context, 'This shared format cannot persist region grids', path);
	}
}

function expectedRegionSchema(version: number): number {
	if (version === YJS_GRID_DOCUMENT_FORMAT) return GRID_REGION_PRESENTATION_SCHEMA;
	if (version === YJS_REGION_LANE_DOCUMENT_FORMAT) return REGION_LANE_PRESENTATION_SCHEMA;
	if (version === YJS_REGION_COMPOSITION_DOCUMENT_FORMAT)
		return REGION_COMPOSITION_PRESENTATION_SCHEMA;
	return REGION_PRESENTATION_SCHEMA;
}

function materializeRegionPresentation(
	ydoc: Y.Doc,
	meta: Y.Map<unknown>,
	options: MaterializeRegionOptions,
): RegionLayoutPresentation | undefined {
	const { version, schema, regions, context } = options;
	if (version === YJS_REGION_DOCUMENT_FORMAT) {
		rejectGridPresentation(ydoc, meta, context);
		if (schema !== REGION_PRESENTATION_SCHEMA) return undefined;
		return { schemaVersion: REGION_PRESENTATION_SCHEMA, regions };
	}
	if (version === YJS_GRID_DOCUMENT_FORMAT) {
		const grid = readGridPresentation(ydoc, meta, context);
		if (schema !== GRID_REGION_PRESENTATION_SCHEMA || grid === undefined) return undefined;
		return { schemaVersion: GRID_REGION_PRESENTATION_SCHEMA, regions, grid };
	}
	rejectGridPresentation(ydoc, meta, context);
	if (version === YJS_REGION_COMPOSITION_DOCUMENT_FORMAT) {
		if (schema !== REGION_COMPOSITION_PRESENTATION_SCHEMA) return undefined;
		return { schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA, regions };
	}
	if (schema !== REGION_LANE_PRESENTATION_SCHEMA) return undefined;
	return { schemaVersion: REGION_LANE_PRESENTATION_SCHEMA, regions };
}

function readSupportedRegionPresentation(
	ydoc: Y.Doc,
	meta: Y.Map<unknown>,
	options: RegionReadOptions,
): RegionLayoutPresentation | undefined {
	const { version, regionLanes, regionGrids, context } = options;
	const schema = meta.get('regionPresentationSchema');
	if (schema !== expectedRegionSchema(version))
		invalid(context, `Unsupported region presentation schema: ${String(schema)}`, [
			'regionPresentation',
			'schemaVersion',
		]);
	const regionCollection = ydoc.getMap<Y.Map<unknown>>(YjsCollection.Regions);
	validateRegionLaneEntries(regionLanes, new Set(regionCollection.keys()), version, context);
	validateRegionGridEntries(regionGrids, new Set(regionCollection.keys()), version, context);
	const regions = readCollection(ydoc, context, {
		sharedName: YjsCollection.Regions,
		collectionName: 'regionPresentation.regions',
		project: (entity, id) => readRegion(entity, id, options),
	});
	return materializeRegionPresentation(ydoc, meta, { version, schema, regions, context });
}

export function readVersionedRegionPresentation(
	ydoc: Y.Doc,
	meta: Y.Map<unknown>,
	version: number,
	context: ReadContext,
): RegionLayoutPresentation | undefined {
	const regionLanes = ydoc.getMap<unknown>(YjsCollection.RegionLanes);
	const regionGrids = ydoc.getMap<unknown>(YjsCollection.RegionGrids);
	if (REGION_YJS_FORMATS.has(version))
		return readSupportedRegionPresentation(ydoc, meta, {
			version,
			regionLanes,
			regionGrids,
			context,
		});
	rejectGridPresentation(ydoc, meta, context);
	validateRegionLaneEntries(regionLanes, new Set(), version, context);
	validateRegionGridEntries(regionGrids, new Set(), version, context);
	if (meta.has('regionPresentationSchema') || ydoc.getMap(YjsCollection.Regions).size > 0)
		invalid(context, 'This shared format cannot persist explicit regions', ['regionPresentation']);
	return undefined;
}
