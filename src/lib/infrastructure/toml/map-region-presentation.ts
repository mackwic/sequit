import {
	GRID_REGION_PRESENTATION_SCHEMA,
	LayoutPolicy,
	type LayoutRegionDefinition,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_PRESENTATION_SCHEMA,
	type RegionLayoutPresentation,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import { mapGridPresentation } from './map-grid-presentation';
import { mapRegionLanePresentation } from './map-region-lane-presentation';
import {
	entries,
	type MappingContext,
	optionalString,
	rejectUnknownFields,
	requiredLayoutOrder,
	string,
	table,
	type UnknownTable,
} from './map-sequit-fields';

const policyByValue: Readonly<Record<string, LayoutPolicy>> = {
	[LayoutPolicy.Layered]: LayoutPolicy.Layered,
};

interface RegionContractFields {
	readonly lanePresentation?: NonNullable<LayoutRegionDefinition['lanePresentation']>;
	readonly grid?: NonNullable<LayoutRegionDefinition['grid']>;
}

function mapRegionContracts(
	region: UnknownTable,
	id: string,
	context: MappingContext,
	schema: number,
): RegionContractFields {
	const fields: {
		lanePresentation?: NonNullable<LayoutRegionDefinition['lanePresentation']>;
		grid?: NonNullable<LayoutRegionDefinition['grid']>;
	} = {};
	if (schema !== REGION_PRESENTATION_SCHEMA && schema !== GRID_REGION_PRESENTATION_SCHEMA) {
		if (region['lanePresentation'] !== undefined) {
			const presentation = mapRegionLanePresentation(region['lanePresentation'], id, context);
			if (presentation !== undefined) fields.lanePresentation = presentation;
		}
	}
	if (schema === REGION_COMPOSITION_PRESENTATION_SCHEMA && region['grid'] !== undefined) {
		const grid = mapGridPresentation(region['grid'], context, [
			'regionPresentation',
			'regions',
			id,
			'grid',
		]);
		if (grid !== undefined) fields.grid = grid;
	}
	return fields;
}

function mapRegion(
	value: unknown,
	id: string,
	context: MappingContext,
	schema: number,
): LayoutRegionDefinition | undefined {
	const path = ['regionPresentation', 'regions', id];
	const region = table(value, path, context);
	if (region === undefined) return undefined;
	const allowLocalLanes =
		schema === REGION_LANE_PRESENTATION_SCHEMA || schema === REGION_COMPOSITION_PRESENTATION_SCHEMA;
	const allowGrid = schema === REGION_COMPOSITION_PRESENTATION_SCHEMA;
	const allowedFields = ['parentId', 'layoutOrder', 'policy'];
	if (allowLocalLanes) allowedFields.push('lanePresentation');
	if (allowGrid) allowedFields.push('grid');
	rejectUnknownFields(region, allowedFields, path, {
		context,
		description: 'region presentation',
	});
	const parentId = optionalString(region['parentId'], [...path, 'parentId'], context);
	const layoutOrder = requiredLayoutOrder(region['layoutOrder'], [...path, 'layoutOrder'], context);
	const policy = string(region['policy'], [...path, 'policy'], context);
	let mappedPolicy: LayoutPolicy | undefined;
	if (policy !== undefined) mappedPolicy = policyByValue[policy];
	if (policy !== undefined && mappedPolicy === undefined)
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Unsupported region layout policy: ${policy}`,
			path: [...path, 'policy'],
		});
	if (layoutOrder === undefined || mappedPolicy === undefined) return undefined;
	const parentFields: { parentId?: string } = {};
	if (parentId !== undefined) parentFields.parentId = parentId;
	return {
		id,
		layoutOrder,
		policy: LayoutPolicy.Layered,
		...parentFields,
		...mapRegionContracts(region, id, context, schema),
	};
}

export function mapRegionPresentation(
	value: unknown,
	context: MappingContext,
	expectedSchema?: number,
): RegionLayoutPresentation | undefined {
	const path = ['regionPresentation'];
	const root = table(value, path, context);
	if (root === undefined) return undefined;
	const schema = root['schemaVersion'];
	const gridSchema = schema === GRID_REGION_PRESENTATION_SCHEMA;
	const laneSchema = schema === REGION_LANE_PRESENTATION_SCHEMA;
	const compositionSchema = schema === REGION_COMPOSITION_PRESENTATION_SCHEMA;
	const legacySchema = schema === REGION_PRESENTATION_SCHEMA || gridSchema;
	const validSchema = legacySchema || laneSchema || compositionSchema;
	let allowedFields = ['schemaVersion', 'regions'];
	if (gridSchema) allowedFields = [...allowedFields, 'grid'];
	rejectUnknownFields(root, allowedFields, path, {
		context,
		description: 'region presentation',
	});
	if (!validSchema)
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Unsupported region presentation schema: ${String(schema)}`,
			path: [...path, 'schemaVersion'],
		});
	if (expectedSchema !== undefined && schema !== expectedSchema)
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: 'Region presentation schema does not match the persistence format',
			path: [...path, 'schemaVersion'],
		});
	const regionsTable = table(root['regions'], [...path, 'regions'], context);
	if (regionsTable === undefined || !validSchema) return undefined;
	const regions: LayoutRegionDefinition[] = [];
	for (const [id, rawRegion] of entries(regionsTable)) {
		const region = mapRegion(rawRegion, id, context, schema);
		if (region !== undefined) regions.push(region);
	}
	if (compositionSchema) return { schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA, regions };
	if (laneSchema) return { schemaVersion: REGION_LANE_PRESENTATION_SCHEMA, regions };
	if (!gridSchema) return { schemaVersion: REGION_PRESENTATION_SCHEMA, regions };
	const grid = mapGridPresentation(root['grid'], context);
	if (grid === undefined) return undefined;
	return { schemaVersion: GRID_REGION_PRESENTATION_SCHEMA, regions, grid };
}
