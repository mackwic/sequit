import {
	type ContentStyle,
	contentStyleFields,
	type DocumentResult,
	EndpointKind,
	groupStateFields,
	LANE_PERSISTENCE_FORMAT,
	LAYOUT_BIASES,
	LAYOUT_DIRECTIONS,
	type LayoutConfiguration,
	layoutConfiguration,
	type LogicDocument,
	type LogicGroup,
	type LogicNature,
	type LogicNode,
	type LogicRelation,
	nodeDescriptionFields,
	type RegionLayoutPresentation,
	type RootLayoutPresentation,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import { migrateLegacyRegionPolicyDocument } from '../../core/document/region-presentation';
import {
	entries,
	type MappingContext,
	optionalString,
	requiredLayoutOrder,
	string,
	table,
	type UnknownTable,
} from './map-sequit-fields';
import { mapJunctions } from './map-sequit-junctions';
import {
	isRegionFormat,
	mapVersionedPresentation,
	mapVersionedRegionPresentation,
	supportedPersistenceFormat,
} from './map-sequit-presentation-versions';

function mapContentStyle(
	entity: UnknownTable,
	path: readonly string[],
	context: MappingContext,
): ContentStyle {
	return contentStyleFields(
		optionalString(entity['color'], [...path, 'color'], context),
		optionalString(entity['icon'], [...path, 'icon'], context),
	);
}

function mapGroupState(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): ReturnType<typeof groupStateFields> {
	try {
		return groupStateFields(value);
	} catch {
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: 'Group state must be expanded or closed',
			path,
		});
		return {};
	}
}

function optionalGroupId(groupId: string | undefined): { readonly groupId?: string } {
	if (groupId === undefined) return {};
	return { groupId };
}

function optionalLaneId(laneId: string | undefined): { readonly laneId?: string } {
	if (laneId === undefined) return {};
	return { laneId };
}

function optionalRegionId(regionId: string | undefined): { readonly regionId?: string } {
	if (regionId === undefined) return {};
	return { regionId };
}

function mapLayout(
	value: UnknownTable | undefined,
	context: MappingContext,
): LayoutConfiguration | undefined {
	const directionValue = value && string(value['direction'], ['layout', 'direction'], context);
	const biasValue = value && string(value['bias'], ['layout', 'bias'], context);
	const direction = LAYOUT_DIRECTIONS.find((candidate) => candidate === directionValue);
	const bias = LAYOUT_BIASES.find((candidate) => candidate === biasValue);
	if (directionValue !== undefined && direction === undefined) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Unsupported layout direction: ${directionValue}`,
			path: ['layout', 'direction'],
		});
	}
	if (biasValue !== undefined && bias === undefined) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Unsupported layout bias: ${biasValue}`,
			path: ['layout', 'bias'],
		});
	}
	let layout: LayoutConfiguration | undefined;
	if (direction !== undefined && bias !== undefined) layout = layoutConfiguration(direction, bias);
	const recognizedLayoutValues = direction !== undefined && bias !== undefined;
	if (recognizedLayoutValues && layout === undefined) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Layout bias ${bias} is incompatible with direction ${direction}`,
			path: ['layout', 'bias'],
		});
	}
	return layout;
}

export function mapSequitDocument(rootValue: unknown): DocumentResult<LogicDocument> {
	const context: MappingContext = { diagnostics: [] };
	const root = table(rootValue, [], context);
	if (!root) return { ok: false, diagnostics: context.diagnostics };

	const format = root['persistenceFormat'];
	if (!supportedPersistenceFormat(format)) {
		context.diagnostics.push({
			code: SequitDiagnosticCode.UnsupportedPersistenceFormat,
			message: `Unsupported persistenceFormat: ${String(format)}`,
			path: ['persistenceFormat'],
		});
	}

	const documentTable = table(root['document'], ['document'], context);
	const layoutTable = table(root['layout'], ['layout'], context);
	const natureTable = table(root['natures'], ['natures'], context);
	const groupTable = table(root['groups'], ['groups'], context);
	const nodeTable = table(root['nodes'], ['nodes'], context);
	const junctionTable = table(root['junctions'], ['junctions'], context);
	const relationTable = table(root['relations'], ['relations'], context);
	const presentation = mapVersionedPresentation(root, format, context);
	const regionPresentation = mapVersionedRegionPresentation(root, format, context);

	const id = documentTable && string(documentTable['id'], ['document', 'id'], context);
	const title = documentTable && string(documentTable['title'], ['document', 'title'], context);
	const layout = mapLayout(layoutTable, context);

	const natures: LogicNature[] = [];
	if (natureTable) {
		for (const [natureId, value] of entries(natureTable)) {
			const path = ['natures', natureId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const label = string(entity['label'], [...path, 'label'], context);
			const color = string(entity['color'], [...path, 'color'], context);
			const style = mapContentStyle(entity, path, context);
			if (label !== undefined && color !== undefined)
				natures.push({ id: natureId, label, ...style, color });
		}
	}

	const groups: LogicGroup[] = [];
	if (groupTable) {
		for (const [groupId, value] of entries(groupTable)) {
			const path = ['groups', groupId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const label = string(entity['label'], [...path, 'label'], context);
			const color = optionalString(entity['color'], [...path, 'color'], context);
			const parentGroupId = optionalString(entity['group'], [...path, 'group'], context);
			const laneId = optionalString(entity['lane'], [...path, 'lane'], context);
			const regionId = optionalString(entity['regionId'], [...path, 'regionId'], context);
			const layoutOrder = requiredLayoutOrder(
				entity['layoutOrder'],
				[...path, 'layoutOrder'],
				context,
			);
			if (label !== undefined && layoutOrder !== undefined) {
				groups.push({
					kind: EndpointKind.Group,
					id: groupId,
					label,
					...contentStyleFields(color, undefined),
					...optionalGroupId(parentGroupId),
					...optionalLaneId(laneId),
					...optionalRegionId(regionId),
					...mapGroupState(entity['state'], [...path, 'state'], context),
					layoutOrder,
				});
			}
		}
	}

	const nodes: LogicNode[] = [];
	if (nodeTable) {
		for (const [nodeId, value] of entries(nodeTable)) {
			const path = ['nodes', nodeId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const natureId = string(entity['nature'], [...path, 'nature'], context);
			const style = mapContentStyle(entity, path, context);
			const groupId = optionalString(entity['group'], [...path, 'group'], context);
			const laneId = optionalString(entity['lane'], [...path, 'lane'], context);
			const regionId = optionalString(entity['regionId'], [...path, 'regionId'], context);
			const markdown = string(entity['markdown'], [...path, 'markdown'], context);
			const description = optionalString(entity['description'], [...path, 'description'], context);
			const layoutOrder = requiredLayoutOrder(
				entity['layoutOrder'],
				[...path, 'layoutOrder'],
				context,
			);
			const requiredNodeValues = natureId !== undefined && markdown !== undefined;
			if (requiredNodeValues && layoutOrder !== undefined) {
				nodes.push({
					kind: EndpointKind.Node,
					...style,
					id: nodeId,
					natureId,
					...optionalGroupId(groupId),
					...optionalLaneId(laneId),
					...optionalRegionId(regionId),
					markdown,
					...nodeDescriptionFields(description),
					layoutOrder,
				});
			}
		}
	}

	const junctions = mapJunctions(junctionTable, context);

	const relations: LogicRelation[] = [];
	if (relationTable) {
		for (const [relationId, value] of entries(relationTable)) {
			const path = ['relations', relationId] as const;
			const entity = table(value, path, context);
			if (!entity) continue;
			const from = string(entity['from'], [...path, 'from'], context);
			const to = string(entity['to'], [...path, 'to'], context);
			if (from !== undefined && to !== undefined) relations.push({ id: relationId, from, to });
		}
	}

	const hasDiagnostics = context.diagnostics.length > 0;
	const missingDocumentIdentity = id === undefined || title === undefined;
	if (hasDiagnostics || missingDocumentIdentity || layout === undefined)
		return { ok: false, diagnostics: context.diagnostics };
	if (!supportedPersistenceFormat(format)) return { ok: false, diagnostics: context.diagnostics };
	if (format === LANE_PERSISTENCE_FORMAT && presentation === undefined)
		return { ok: false, diagnostics: context.diagnostics };
	const regionFormat = isRegionFormat(format);
	if (regionFormat && regionPresentation === undefined)
		return { ok: false, diagnostics: context.diagnostics };
	const presentationField: { presentation?: RootLayoutPresentation } = {};
	if (presentation !== undefined) presentationField.presentation = presentation;
	const regionPresentationField: { regionPresentation?: RegionLayoutPresentation } = {};
	if (regionPresentation !== undefined)
		regionPresentationField.regionPresentation = regionPresentation;
	return {
		ok: true,
		value: migrateLegacyRegionPolicyDocument({
			persistenceFormat: format,
			id,
			title,
			layout,
			...presentationField,
			...regionPresentationField,
			natures,
			groups,
			nodes,
			junctions,
			relations,
		}),
	};
}
